export const PROTOCOL_VERSION = 1;
export const FRAME_MAGIC = new Uint8Array([0x53, 0x4b]);
export const DEFAULT_HOP_LIMIT = 3;
export const MAX_PACKET_BYTES = 4096;
export const MAX_RELAY_QUEUE_ITEMS = 512;
export const MAX_RELAY_ATTEMPTS = 8;
export const RELAY_RETRY_BASE_MS = 2_000;
export const NEARBY_SERVICE_ID = "in.sanketsetu.alert.nearby.v1";

/** BLE identifiers are fixed across iOS and Android for cross-platform discovery. */
export const BLE_SERVICE_UUID = "9E1A0001-6C1B-4D0B-9B0A-53414E4B4554";
export const BLE_RX_CHARACTERISTIC_UUID = "9E1A0002-6C1B-4D0B-9B0A-53414E4B4554";
export const BLE_TX_CHARACTERISTIC_UUID = "9E1A0003-6C1B-4D0B-9B0A-53414E4B4554";
export const BLE_FRAME_VERSION = 1;
export const BLE_CHUNK_HEADER_BYTES = 13;
export const BLE_CHUNK_PAYLOAD_BYTES = 160;
export const MAX_BLE_FRAME_BYTES = MAX_PACKET_BYTES;


export type MeshPacketType = "announce" | "handshake" | "message" | "ack";
export type AcknowledgementKind = "received" | "read";

export interface BleChunk {
  frameId: number;
  totalChunks: number;
  index: number;
  totalLength: number;
  payload: Uint8Array;
}

export function chunkBleFrame(frame: Uint8Array, frameId: number): Uint8Array[] {
  if (frame.length === 0 || frame.length > MAX_BLE_FRAME_BYTES) throw new Error("Invalid BLE frame length");
  const totalChunks = Math.ceil(frame.length / BLE_CHUNK_PAYLOAD_BYTES);
  if (totalChunks > 255) throw new Error("BLE frame requires too many chunks");
  return Array.from({ length: totalChunks }, (_, index) => {
    const start = index * BLE_CHUNK_PAYLOAD_BYTES;
    const payload = frame.slice(start, start + BLE_CHUNK_PAYLOAD_BYTES);
    const result = new Uint8Array(BLE_CHUNK_HEADER_BYTES + payload.length);
    result.set([0x42, 0x43, BLE_FRAME_VERSION], 0);
    new DataView(result.buffer).setUint32(3, frameId >>> 0);
    result[7] = totalChunks;
    result[8] = index;
    new DataView(result.buffer).setUint32(9, frame.length);
    result.set(payload, BLE_CHUNK_HEADER_BYTES);
    return result;
  });
}

export function decodeBleChunk(chunk: Uint8Array): BleChunk {
  if (chunk.length < BLE_CHUNK_HEADER_BYTES || chunk[0] !== 0x42 || chunk[1] !== 0x43 || chunk[2] !== BLE_FRAME_VERSION) {
    throw new Error("Invalid BLE chunk header");
  }
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  const frameId = view.getUint32(3);
  const totalChunks = chunk[7];
  const index = chunk[8];
  const totalLength = view.getUint32(9);
  if (totalChunks === 0 || index >= totalChunks || totalLength === 0 || totalLength > MAX_BLE_FRAME_BYTES) throw new Error("Invalid BLE chunk metadata");
  return { frameId, totalChunks, index, totalLength, payload: chunk.slice(BLE_CHUNK_HEADER_BYTES) };
}

export function reassembleBleChunks(chunks: Iterable<Uint8Array>): Uint8Array | null {
  const decoded = Array.from(chunks, decodeBleChunk);
  if (decoded.length === 0) return null;
  const first = decoded[0];
  if (decoded.length !== first.totalChunks || decoded.some((chunk) => chunk.frameId !== first.frameId || chunk.totalChunks !== first.totalChunks || chunk.totalLength !== first.totalLength)) return null;
  const byIndex = new Map(decoded.map((chunk) => [chunk.index, chunk]));
  if (byIndex.size !== first.totalChunks) return null;
  const result = new Uint8Array(first.totalLength);
  let offset = 0;
  for (let index = 0; index < first.totalChunks; index += 1) {
    const chunk = byIndex.get(index);
    if (!chunk || offset + chunk.payload.length > result.length) return null;
    result.set(chunk.payload, offset);
    offset += chunk.payload.length;
  }
  return offset === result.length ? result : null;
}


export type TransportKind = "mesh" | "internet";
export type DeliveryState =
  | "queued"
  | "relaying"
  | "sent"
  | "delivered"
  | "read"
  | "expired"
  | "failed";

export interface MeshPacket {
  version: number;
  type: MeshPacketType;
  packetId: string;
  messageId?: string;
  senderId: string;
  recipientId?: string;
  conversationId?: string;
  cryptoVersion?: number;
  senderSigningPublicKey?: string;
  senderEncryptionPublicKey?: string;
  createdAt: number;
  expiresAt: number;
  hopLimit: number;
  hopCount: number;
  /** The immediate sender of this copy; used to prevent bouncing back. */
  lastHopId?: string;
  ciphertext?: string;
  payload?: string;
  signature?: string;
  /** Original packet ID authenticated by an acknowledgement. */
  ackForPacketId?: string;
  ackKind?: AcknowledgementKind;
}

export interface MessageEnvelope {
  messageId: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  ciphertext: string;
  createdAt: number;
  expiresAt: number;
  deliveryState: DeliveryState;
  transport?: TransportKind;
  cryptoVersion?: number;
  senderSigningPublicKey?: string;
  senderEncryptionPublicKey?: string;
  signature?: string;
}

export interface MeshPeer {
  peerId: string;
  linkId?: string;
  displayName?: string;
  encryptionPublicKey?: string;
  signingPublicKey?: string;
  identityFingerprint?: string;
  lastSeenAt: number;
  verified: boolean;
  connectionState: "discovered" | "connecting" | "connected" | "unavailable";
  transport: "ble" | "nearby" | "internet";
}

export interface TransportStatus {
  kind: TransportKind;
  state: "disabled" | "starting" | "ready" | "error";
  detail?: string;
}

export interface TransportMessage {
  message: MessageEnvelope;
  packet: MeshPacket;
}

export interface RelayQueueRecord {
  queueId: string;
  packet: MeshPacket;
  attempts: number;
  nextAttemptAt: number;
  enqueuedAt: number;
  lastError?: string;
}

export interface RouteCandidate {
  peer: MeshPeer;
  score: number;
}

export function selectNextHop(packet: MeshPacket, peers: MeshPeer[], options: { localPeerId?: string; excludeLinkId?: string; now?: number } = {}): MeshPeer | null {
  const now = options.now ?? Date.now();
  const hasDirectDestination = (packet.type === "message" || packet.type === "ack") && peers.some((peer) => peer.peerId === packet.recipientId && peer.connectionState === "connected" && Boolean(peer.linkId) && peer.verified);
  if (!canRelay(packet, now) && !hasDirectDestination) return null;
  const localPeerId = options.localPeerId;
  const candidates: RouteCandidate[] = peers
    .filter((peer) => peer.connectionState === "connected" && Boolean(peer.linkId))
    .filter((peer) => packet.type === "announce" || peer.verified)
    .filter((peer) => peer.linkId !== options.excludeLinkId)
    .filter((peer) => peer.peerId !== localPeerId && peer.peerId !== packet.senderId && peer.peerId !== packet.lastHopId)
    .map((peer) => {
      const ageSeconds = Math.max(0, (now - peer.lastSeenAt) / 1000);
      const freshness = Math.max(0, 30 - Math.min(30, ageSeconds));
      const destinationBonus = packet.recipientId && peer.peerId === packet.recipientId ? 1_000 : 0;
      const verifiedBonus = peer.verified ? 100 : 0;
      const transportBonus = peer.transport === "nearby" ? 30 : peer.transport === "ble" ? 15 : 0;
      return { peer, score: destinationBonus + verifiedBonus + transportBonus + freshness };
    })
    .sort((left, right) => right.score - left.score || left.peer.peerId.localeCompare(right.peer.peerId));
  return candidates[0]?.peer ?? null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function utf8Encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function utf8Decode(value: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}

export function encodePacket(packet: MeshPacket): Uint8Array {
  if (packet.version !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocol version: ${packet.version}`);
  }
  if (packet.hopCount < 0 || packet.hopCount > packet.hopLimit) {
    throw new Error("Invalid hop count");
  }
  const body = utf8Encode(JSON.stringify(stableValue(packet)));
  const frame = new Uint8Array(FRAME_MAGIC.length + 1 + body.length);
  frame.set(FRAME_MAGIC, 0);
  frame[2] = packet.version;
  frame.set(body, 3);
  if (frame.byteLength > MAX_PACKET_BYTES) {
    throw new Error(`Packet exceeds ${MAX_PACKET_BYTES} bytes`);
  }
  return frame;
}

export function decodePacket(frame: Uint8Array): MeshPacket {
  if (frame.byteLength < 4 || frame[0] !== FRAME_MAGIC[0] || frame[1] !== FRAME_MAGIC[1]) {
    throw new Error("Invalid Sanketly frame header");
  }
  if (frame.byteLength > MAX_PACKET_BYTES) {
    throw new Error("Frame exceeds maximum packet size");
  }
  const version = frame[2];
  if (version !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocol version: ${version}`);
  }
  const parsed: unknown = JSON.parse(utf8Decode(frame.slice(3)));
  if (!isMeshPacket(parsed)) throw new Error("Invalid mesh packet");
  return parsed;
}

export function isMeshPacket(value: unknown): value is MeshPacket {
  if (!value || typeof value !== "object") return false;
  const packet = value as Partial<MeshPacket>;
  return (
    packet.version === PROTOCOL_VERSION &&
    typeof packet.type === "string" &&
    ["announce", "handshake", "message", "ack"].includes(packet.type) &&
    typeof packet.packetId === "string" &&
    typeof packet.senderId === "string" &&
    typeof packet.createdAt === "number" &&
    typeof packet.expiresAt === "number" &&
    typeof packet.hopLimit === "number" &&
    typeof packet.hopCount === "number" &&
    (packet.lastHopId === undefined || typeof packet.lastHopId === "string") &&
    packet.hopLimit >= 0 &&
    packet.hopCount >= 0 &&
    packet.hopCount <= packet.hopLimit &&
    (packet.type !== "message" || (
      typeof packet.messageId === "string" &&
      typeof packet.recipientId === "string" &&
      typeof packet.conversationId === "string" &&
      typeof packet.cryptoVersion === "number" &&
      typeof packet.senderSigningPublicKey === "string" &&
      typeof packet.senderEncryptionPublicKey === "string" &&
      typeof packet.ciphertext === "string" &&
      typeof packet.signature === "string"
    )) &&
    (packet.type !== "ack" || (
      typeof packet.messageId === "string" &&
      typeof packet.recipientId === "string" &&
      typeof packet.conversationId === "string" &&
      typeof packet.senderSigningPublicKey === "string" &&
      typeof packet.signature === "string" &&
      typeof packet.ackForPacketId === "string" &&
      (packet.ackKind === "received" || packet.ackKind === "read")
    ))
  );
}

export function canRelay(packet: MeshPacket, now = Date.now()): boolean {
  return packet.expiresAt > now && packet.hopCount < packet.hopLimit;
}

export function relayPacket(packet: MeshPacket, relayPeerId: string, now = Date.now()): MeshPacket {
  if (!relayPeerId || !canRelay(packet, now)) throw new Error("Packet cannot be relayed");
  return { ...packet, hopCount: packet.hopCount + 1, lastHopId: relayPeerId };
}

export function nextRelayAttemptAt(attempts: number, now = Date.now()): number {
  const boundedAttempts = Math.max(0, Math.min(attempts, MAX_RELAY_ATTEMPTS));
  return now + RELAY_RETRY_BASE_MS * (2 ** boundedAttempts);
}

export function shouldRelayPacket(packet: MeshPacket, localPeerId: string, now = Date.now()): boolean {
  return Boolean(localPeerId) && packet.senderId !== localPeerId && packet.recipientId !== localPeerId && canRelay(packet, now);
}

export class DeduplicationCache {
  private readonly entries = new Map<string, number>();

  constructor(private readonly maxEntries = 2048, private readonly retentionMs = 7 * 24 * 60 * 60 * 1000) {}

  has(id: string, now = Date.now()): boolean {
    this.prune(now);
    return this.entries.has(id);
  }

  remember(id: string, now = Date.now()): boolean {
    this.prune(now);
    if (this.entries.has(id)) return false;
    this.entries.set(id, now);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return true;
  }

  get size(): number {
    return this.entries.size;
  }

  private prune(now: number): void {
    for (const [id, timestamp] of this.entries) {
      if (now - timestamp > this.retentionMs) this.entries.delete(id);
    }
  }
}

export function createAnnouncePacket(input: {
  packetId: string;
  senderId: string;
  payload: string;
  now?: number;
  ttlMs?: number;
  hopLimit?: number;
}): MeshPacket {
  const now = input.now ?? Date.now();
  return {
    version: PROTOCOL_VERSION,
    type: "announce",
    packetId: input.packetId,
    senderId: input.senderId,
    payload: input.payload,
    createdAt: now,
    expiresAt: now + (input.ttlMs ?? 60_000),
    hopLimit: input.hopLimit ?? 2,
    hopCount: 0,
  };
}

export function createMessagePacket(input: {
  packetId: string;
  messageId: string;
  senderId: string;
  recipientId: string;
  conversationId: string;
  ciphertext: string;
  signature: string;
  cryptoVersion: number;
  senderSigningPublicKey: string;
  senderEncryptionPublicKey: string;
  now?: number;
  ttlMs?: number;
  hopLimit?: number;
}): MeshPacket {
  const now = input.now ?? Date.now();
  return {
    version: PROTOCOL_VERSION,
    type: "message",
    packetId: input.packetId,
    messageId: input.messageId,
    senderId: input.senderId,
    recipientId: input.recipientId,
    conversationId: input.conversationId,
    cryptoVersion: input.cryptoVersion,
    senderSigningPublicKey: input.senderSigningPublicKey,
    senderEncryptionPublicKey: input.senderEncryptionPublicKey,
    createdAt: now,
    expiresAt: now + (input.ttlMs ?? 7 * 24 * 60 * 60 * 1000),
    hopLimit: input.hopLimit ?? DEFAULT_HOP_LIMIT,
    hopCount: 0,
    lastHopId: input.senderId,
    ciphertext: input.ciphertext,
    signature: input.signature,
  };
}
