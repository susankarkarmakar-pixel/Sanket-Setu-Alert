import { beforeAll, describe, expect, it } from "vitest";
import {
  decryptMeshMessage,
  createAcknowledgementPacket,
  decryptMeshPacket,
  encryptMeshMessage,
  derivePeerFingerprint,
  envelopeToMeshPacket,
  generateMeshIdentity,
  initMeshCrypto,
  verifyAcknowledgementPacket,
  type EncryptedMeshEnvelope,
} from "./index";

let alice: Awaited<ReturnType<typeof generateMeshIdentity>>;
let bob: Awaited<ReturnType<typeof generateMeshIdentity>>;

beforeAll(async () => {
  await initMeshCrypto();
  alice = await generateMeshIdentity();
  bob = await generateMeshIdentity();
});

async function makeEnvelope(): Promise<EncryptedMeshEnvelope> {
  return encryptMeshMessage({
    identity: alice,
    recipient: { peerId: bob.peerId, encryptionPublicKey: bob.encryptionPublicKey },
    messageId: "message-1",
    conversationId: "dm:bob",
    body: "hello through the mesh",
    createdAt: 1_000,
    expiresAt: 10_000,
  });
}

describe("Sanketly mesh encryption", () => {
  it("derives a stable fingerprint bound to both public keys", () => {
    const fingerprint = derivePeerFingerprint({ signingPublicKey: alice.signingPublicKey, encryptionPublicKey: alice.encryptionPublicKey });
    expect(fingerprint).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){7}$/);
    expect(derivePeerFingerprint({ signingPublicKey: alice.signingPublicKey, encryptionPublicKey: alice.encryptionPublicKey })).toBe(fingerprint);
    expect(derivePeerFingerprint({ signingPublicKey: alice.signingPublicKey, encryptionPublicKey: bob.encryptionPublicKey })).not.toBe(fingerprint);
    expect(derivePeerFingerprint({ signingPublicKey: bob.signingPublicKey, encryptionPublicKey: alice.encryptionPublicKey })).not.toBe(fingerprint);
  });

  it("encrypts and decrypts an authenticated message", async () => {
    const envelope = await makeEnvelope();
    await expect(decryptMeshMessage({ identity: bob, envelope, now: 2_000 })).resolves.toMatchObject({
      messageId: "message-1",
      senderId: alice.peerId,
      recipientId: bob.peerId,
      body: "hello through the mesh",
    });
    expect(envelope.ciphertext).not.toContain("hello through the mesh");
  });

  it("rejects ciphertext tampering", async () => {
    const envelope = await makeEnvelope();
    const tampered = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` };
    await expect(decryptMeshMessage({ identity: bob, envelope: tampered, now: 2_000 })).rejects.toThrow("Envelope signature verification failed");
  });

  it("rejects metadata tampering because metadata is signed", async () => {
    const envelope = await makeEnvelope();
    const tampered = { ...envelope, recipientId: alice.peerId };
    await expect(decryptMeshMessage({ identity: bob, envelope: tampered, now: 2_000 })).rejects.toThrow("Envelope is addressed to another peer");
  });

  it("rejects a forged sender key and peer ID combination", async () => {
    const envelope = await makeEnvelope();
    const forged = { ...envelope, senderSigningPublicKey: bob.signingPublicKey };
    await expect(decryptMeshMessage({ identity: bob, envelope: forged, now: 2_000 })).rejects.toThrow("Sender identity does not match signing key");
  });

  it("rejects an envelope addressed to a different recipient", async () => {
    const envelope = await makeEnvelope();
    await expect(decryptMeshMessage({ identity: alice, envelope, now: 2_000 })).rejects.toThrow("Envelope is addressed to another peer");
  });

  it("rejects expired envelopes before decryption", async () => {
    const envelope = await makeEnvelope();
    await expect(decryptMeshMessage({ identity: bob, envelope, now: 10_000 })).rejects.toThrow("Envelope has expired");
  });

  it("binds the encrypted envelope to a relay-safe mesh packet", async () => {
    const envelope = await makeEnvelope();
    const packet = envelopeToMeshPacket({ envelope, packetId: "packet-1", hopLimit: 3 });
    await expect(decryptMeshPacket({ identity: bob, packet, now: 2_000 })).resolves.toMatchObject({ body: "hello through the mesh" });
  });

  it("creates and verifies a recipient acknowledgement", async () => {
    const envelope = await makeEnvelope();
    const originalPacket = envelopeToMeshPacket({ envelope, packetId: "packet-ack" });
    const acknowledgement = await createAcknowledgementPacket({ identity: bob, originalPacket, packetId: "ack-1", now: 2_000 });
    expect(verifyAcknowledgementPacket({ packet: acknowledgement, expectedRecipientId: alice.peerId, now: 2_001 })).toBe(true);
    expect(acknowledgement).toMatchObject({ type: "ack", messageId: "message-1", senderId: bob.peerId, recipientId: alice.peerId, ackForPacketId: "packet-ack", ackKind: "received" });
  });

  it("rejects tampered and expired acknowledgements", async () => {
    const envelope = await makeEnvelope();
    const originalPacket = envelopeToMeshPacket({ envelope, packetId: "packet-ack-tamper" });
    const acknowledgement = await createAcknowledgementPacket({ identity: bob, originalPacket, packetId: "ack-tamper", now: 2_000 });
    expect(() => verifyAcknowledgementPacket({ packet: { ...acknowledgement, ackForPacketId: "other-packet" }, expectedRecipientId: alice.peerId, now: 2_001 })).toThrow("Acknowledgement signature verification failed");
    expect(() => verifyAcknowledgementPacket({ packet: acknowledgement, expectedRecipientId: alice.peerId, now: 10_000 })).toThrow("Acknowledgement has expired");
  });
});
