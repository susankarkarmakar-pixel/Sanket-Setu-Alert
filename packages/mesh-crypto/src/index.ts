import sodium from "libsodium-wrappers-sumo";
import { createMessagePacket, type MeshPacket } from "@sanketly/protocol";

export const MESH_CRYPTO_VERSION = 1;
export const IDENTITY_DOMAIN = "sanketly/mesh-identity/v1";
export const MESSAGE_DOMAIN = "sanketly/mesh-message/v1";
export const ACKNOWLEDGEMENT_DOMAIN = "sanketly/mesh-acknowledgement/v1";
export const PEER_FINGERPRINT_DOMAIN = "sanketly/peer-fingerprint/v1";

export interface MeshIdentity {
  peerId: string;
  signingPublicKey: string;
  signingPrivateKey: string;
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
}

export interface RecipientPublicKey {
  peerId: string;
  encryptionPublicKey: string;
}

export interface EncryptedMeshEnvelope {
  version: number;
  messageId: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  createdAt: number;
  expiresAt: number;
  senderSigningPublicKey: string;
  senderEncryptionPublicKey: string;
  ciphertext: string;
  signature: string;
}

export interface DecryptedMeshMessage {
  messageId: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: number;
  expiresAt: number;
}

export interface EncryptedMeshPacket extends MeshPacket {
  type: "message";
  messageId: string;
  recipientId: string;
  conversationId: string;
  cryptoVersion: number;
  senderSigningPublicKey: string;
  senderEncryptionPublicKey: string;
  ciphertext: string;
  signature: string;
}

let readyPromise: Promise<void> | undefined;

export function initMeshCrypto(): Promise<void> {
  readyPromise ??= sodium.ready.then(() => undefined);
  return readyPromise;
}

function requireReady(): void {
  if (!readyPromise) throw new Error("Mesh crypto is not initialized");
}

function toBase64(value: Uint8Array): string {
  return sodium.to_base64(value, sodium.base64_variants.ORIGINAL);
}

function fromBase64(value: string): Uint8Array {
  return sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
}

function utf8(value: string): Uint8Array {
  return sodium.from_string(value);
}

function text(value: Uint8Array): string {
  return sodium.to_string(value);
}

function canonicalMetadata(input: {
  version: number;
  messageId: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  createdAt: number;
  expiresAt: number;
  senderSigningPublicKey: string;
  senderEncryptionPublicKey: string;
}): string {
  return [
    MESSAGE_DOMAIN,
    String(input.version),
    input.messageId,
    input.conversationId,
    input.senderId,
    input.recipientId,
    String(input.createdAt),
    String(input.expiresAt),
    input.senderSigningPublicKey,
    input.senderEncryptionPublicKey,
  ].join("\n");
}

function canonicalAcknowledgementMetadata(input: {
  packetId: string;
  messageId: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  ackForPacketId: string;
  ackKind: "received" | "read";
  createdAt: number;
  expiresAt: number;
  senderSigningPublicKey: string;
}): string {
  return [
    ACKNOWLEDGEMENT_DOMAIN,
    String(MESH_CRYPTO_VERSION),
    input.packetId,
    input.messageId,
    input.conversationId,
    input.senderId,
    input.recipientId,
    input.ackForPacketId,
    input.ackKind,
    String(input.createdAt),
    String(input.expiresAt),
    input.senderSigningPublicKey,
  ].join("\n");
}

export async function createAcknowledgementPacket(input: {
  identity: MeshIdentity;
  originalPacket: MeshPacket;
  packetId: string;
  ackKind?: "received" | "read";
  now?: number;
  ttlMs?: number;
}): Promise<MeshPacket> {
  await initMeshCrypto();
  requireReady();
  const original = input.originalPacket;
  const now = input.now ?? Date.now();
  const ackKind = input.ackKind ?? "received";
  if (original.type !== "message" || !original.messageId || !original.recipientId || !original.conversationId) {
    throw new Error("Acknowledgement requires an original message packet");
  }
  if (original.recipientId !== input.identity.peerId) throw new Error("Only the message recipient can acknowledge it");
  const expiresAt = Math.min(original.expiresAt, now + (input.ttlMs ?? 24 * 60 * 60 * 1000));
  if (expiresAt <= now) throw new Error("Acknowledgement expiry is invalid");
  const metadata = {
    packetId: input.packetId,
    messageId: original.messageId,
    conversationId: original.conversationId,
    senderId: input.identity.peerId,
    recipientId: original.senderId,
    ackForPacketId: original.packetId,
    ackKind,
    createdAt: now,
    expiresAt,
    senderSigningPublicKey: input.identity.signingPublicKey,
  };
  const signature = sodium.crypto_sign_detached(utf8(canonicalAcknowledgementMetadata(metadata)), fromBase64(input.identity.signingPrivateKey));
  return {
    version: MESH_CRYPTO_VERSION,
    type: "ack",
    packetId: input.packetId,
    messageId: metadata.messageId,
    senderId: metadata.senderId,
    recipientId: metadata.recipientId,
    conversationId: metadata.conversationId,
    senderSigningPublicKey: metadata.senderSigningPublicKey,
    createdAt: metadata.createdAt,
    expiresAt: metadata.expiresAt,
    hopLimit: 3,
    hopCount: 0,
    lastHopId: metadata.senderId,
    ackForPacketId: metadata.ackForPacketId,
    ackKind: metadata.ackKind,
    signature: toBase64(signature),
  };
}

export function verifyAcknowledgementPacket(input: {
  packet: MeshPacket;
  expectedRecipientId?: string;
  now?: number;
}): boolean {
  const packet = input.packet;
  const now = input.now ?? Date.now();
  if (packet.type !== "ack" || !packet.messageId || !packet.recipientId || !packet.conversationId || !packet.ackForPacketId || !packet.senderSigningPublicKey || !packet.signature || !packet.ackKind) {
    throw new Error("Acknowledgement packet is incomplete");
  }
  if (packet.expiresAt <= now || packet.expiresAt <= packet.createdAt) throw new Error("Acknowledgement has expired");
  if (input.expectedRecipientId && packet.recipientId !== input.expectedRecipientId) throw new Error("Acknowledgement is addressed to another peer");
  if (derivePeerId(packet.senderSigningPublicKey) !== packet.senderId) throw new Error("Acknowledgement identity does not match signing key");
  const metadata = {
    packetId: packet.packetId,
    messageId: packet.messageId,
    conversationId: packet.conversationId,
    senderId: packet.senderId,
    recipientId: packet.recipientId,
    ackForPacketId: packet.ackForPacketId,
    ackKind: packet.ackKind,
    createdAt: packet.createdAt,
    expiresAt: packet.expiresAt,
    senderSigningPublicKey: packet.senderSigningPublicKey,
  };
  if (!sodium.crypto_sign_verify_detached(fromBase64(packet.signature), utf8(canonicalAcknowledgementMetadata(metadata)), fromBase64(packet.senderSigningPublicKey))) {
    throw new Error("Acknowledgement signature verification failed");
  }
  return true;
}

function assertSafeEnvelope(envelope: EncryptedMeshEnvelope, now: number): void {
  if (envelope.version !== MESH_CRYPTO_VERSION) throw new Error("Unsupported mesh crypto version");
  if (!envelope.messageId || !envelope.conversationId || !envelope.senderId || !envelope.recipientId) {
    throw new Error("Envelope identity metadata is incomplete");
  }
  if (envelope.expiresAt <= envelope.createdAt) throw new Error("Envelope expiry is invalid");
  if (envelope.expiresAt <= now) throw new Error("Envelope has expired");
  if (!envelope.ciphertext || !envelope.signature) throw new Error("Envelope authentication data is incomplete");
}

export async function generateMeshIdentity(): Promise<MeshIdentity> {
  await initMeshCrypto();
  requireReady();
  const signing = sodium.crypto_sign_keypair();
  const encryption = sodium.crypto_box_keypair();
  const peerId = toBase64(sodium.crypto_generichash(16, signing.publicKey, utf8(IDENTITY_DOMAIN)));
  return {
    peerId,
    signingPublicKey: toBase64(signing.publicKey),
    signingPrivateKey: toBase64(signing.privateKey),
    encryptionPublicKey: toBase64(encryption.publicKey),
    encryptionPrivateKey: toBase64(encryption.privateKey),
  };
}

export function derivePeerId(signingPublicKey: string): string {
  requireReady();
  return toBase64(sodium.crypto_generichash(16, fromBase64(signingPublicKey), utf8(IDENTITY_DOMAIN)));
}

export function derivePeerFingerprint(input: { signingPublicKey: string; encryptionPublicKey: string }): string {
  requireReady();
  if (!input.signingPublicKey || !input.encryptionPublicKey) throw new Error("Both public keys are required for a peer fingerprint");
  const digest = sodium.crypto_generichash(16, utf8(`${PEER_FINGERPRINT_DOMAIN}\n${input.signingPublicKey}\n${input.encryptionPublicKey}`), null);
  const hexadecimal = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return hexadecimal.match(/.{4}/g)?.join("-") ?? hexadecimal;
}

export async function encryptMeshMessage(input: {
  identity: MeshIdentity;
  recipient: RecipientPublicKey;
  messageId: string;
  conversationId: string;
  body: string;
  createdAt: number;
  expiresAt: number;
}): Promise<EncryptedMeshEnvelope> {
  await initMeshCrypto();
  requireReady();
  if (!input.body) throw new Error("Cannot encrypt an empty message");
  if (input.expiresAt <= input.createdAt) throw new Error("Message expiry is invalid");
  if (input.identity.peerId !== derivePeerId(input.identity.signingPublicKey)) {
    throw new Error("Identity peer ID does not match its signing key");
  }
  if (!input.recipient.peerId || !input.recipient.encryptionPublicKey) throw new Error("Recipient key is required");

  const metadata = {
    version: MESH_CRYPTO_VERSION,
    messageId: input.messageId,
    conversationId: input.conversationId,
    senderId: input.identity.peerId,
    recipientId: input.recipient.peerId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    senderSigningPublicKey: input.identity.signingPublicKey,
    senderEncryptionPublicKey: input.identity.encryptionPublicKey,
  };
  const aad = utf8(canonicalMetadata(metadata));
  const plaintext = utf8(input.body);
  const ciphertext = sodium.crypto_box_seal(plaintext, fromBase64(input.recipient.encryptionPublicKey));
  const signature = sodium.crypto_sign_detached(new Uint8Array([...aad, ...ciphertext]), fromBase64(input.identity.signingPrivateKey));
  return {
    ...metadata,
    ciphertext: toBase64(ciphertext),
    signature: toBase64(signature),
  };
}

export function envelopeToMeshPacket(input: {
  envelope: EncryptedMeshEnvelope;
  packetId: string;
  hopLimit?: number;
}): EncryptedMeshPacket {
  return createMessagePacket({
    packetId: input.packetId,
    messageId: input.envelope.messageId,
    senderId: input.envelope.senderId,
    recipientId: input.envelope.recipientId,
    conversationId: input.envelope.conversationId,
    ciphertext: input.envelope.ciphertext,
    signature: input.envelope.signature,
    cryptoVersion: input.envelope.version,
    senderSigningPublicKey: input.envelope.senderSigningPublicKey,
    senderEncryptionPublicKey: input.envelope.senderEncryptionPublicKey,
    now: input.envelope.createdAt,
    ttlMs: input.envelope.expiresAt - input.envelope.createdAt,
    hopLimit: input.hopLimit,
  }) as EncryptedMeshPacket;
}

export async function decryptMeshPacket(input: {
  identity: MeshIdentity;
  packet: MeshPacket;
  now?: number;
}): Promise<DecryptedMeshMessage> {
  if (input.packet.type !== "message" || !input.packet.messageId || !input.packet.recipientId || !input.packet.conversationId || !input.packet.ciphertext || !input.packet.signature || !input.packet.cryptoVersion || !input.packet.senderSigningPublicKey || !input.packet.senderEncryptionPublicKey) {
    throw new Error("Mesh packet does not contain a complete encrypted envelope");
  }
  return decryptMeshMessage({
    identity: input.identity,
    now: input.now,
    envelope: {
      version: input.packet.cryptoVersion,
      messageId: input.packet.messageId,
      conversationId: input.packet.conversationId,
      senderId: input.packet.senderId,
      recipientId: input.packet.recipientId,
      createdAt: input.packet.createdAt,
      expiresAt: input.packet.expiresAt,
      senderSigningPublicKey: input.packet.senderSigningPublicKey,
      senderEncryptionPublicKey: input.packet.senderEncryptionPublicKey,
      ciphertext: input.packet.ciphertext,
      signature: input.packet.signature,
    },
  });
}

export async function decryptMeshMessage(input: {
  identity: MeshIdentity;
  envelope: EncryptedMeshEnvelope;
  now?: number;
}): Promise<DecryptedMeshMessage> {
  await initMeshCrypto();
  requireReady();
  const now = input.now ?? Date.now();
  assertSafeEnvelope(input.envelope, now);
  if (input.envelope.recipientId !== input.identity.peerId) throw new Error("Envelope is addressed to another peer");
  if (derivePeerId(input.envelope.senderSigningPublicKey) !== input.envelope.senderId) {
    throw new Error("Sender identity does not match signing key");
  }
  const metadata = {
    version: input.envelope.version,
    messageId: input.envelope.messageId,
    conversationId: input.envelope.conversationId,
    senderId: input.envelope.senderId,
    recipientId: input.envelope.recipientId,
    createdAt: input.envelope.createdAt,
    expiresAt: input.envelope.expiresAt,
    senderSigningPublicKey: input.envelope.senderSigningPublicKey,
    senderEncryptionPublicKey: input.envelope.senderEncryptionPublicKey,
  };
  const aad = utf8(canonicalMetadata(metadata));
  const ciphertext = fromBase64(input.envelope.ciphertext);
  const signature = fromBase64(input.envelope.signature);
  if (!sodium.crypto_sign_verify_detached(signature, new Uint8Array([...aad, ...ciphertext]), fromBase64(input.envelope.senderSigningPublicKey))) {
    throw new Error("Envelope signature verification failed");
  }
  const plaintext = sodium.crypto_box_seal_open(ciphertext, fromBase64(input.identity.encryptionPublicKey), fromBase64(input.identity.encryptionPrivateKey));
  return {
    messageId: input.envelope.messageId,
    conversationId: input.envelope.conversationId,
    senderId: input.envelope.senderId,
    recipientId: input.envelope.recipientId,
    body: text(plaintext),
    createdAt: input.envelope.createdAt,
    expiresAt: input.envelope.expiresAt,
  };
}
