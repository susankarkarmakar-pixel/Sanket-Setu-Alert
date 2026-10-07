import type {
  DeliveryState,
  MessageEnvelope,
  MeshPacket,
  MeshPeer,
  RelayQueueRecord,
  RouteCandidate,
  TransportKind,
  TransportMessage,
  TransportStatus,
} from "@sanketly/protocol";

export type {
  DeliveryState,
  MessageEnvelope,
  MeshPacket,
  MeshPeer,
  RelayQueueRecord,
  RouteCandidate,
  TransportKind,
  TransportMessage,
  TransportStatus,
};

export interface Conversation {
  id: string;
  peerId: string;
  title: string;
  lastMessage?: MessageEnvelope;
  unreadCount: number;
}

export interface OutboxRecord extends MessageEnvelope {
  meshPacket?: MeshPacket;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
}

export interface TransportAdapter {
  readonly kind: TransportKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): TransportStatus;
  listPeers(): Promise<MeshPeer[]>;
  send(message: OutboxRecord): Promise<TransportMessage>;
  onMessage(listener: (message: TransportMessage) => void): () => void;
  onStatus(listener: (status: TransportStatus) => void): () => void;
}

export interface OutboxStore {
  list(): Promise<OutboxRecord[]>;
  upsert(record: OutboxRecord): Promise<void>;
  remove(messageId: string): Promise<void>;
  clear(): Promise<void>;
}

export function createConversationId(peerId: string): string {
  return `dm:${peerId}`;
}

export function nextDeliveryState(current: DeliveryState, next: DeliveryState): DeliveryState {
  const rank: Record<DeliveryState, number> = {
    queued: 0,
    relaying: 1,
    sent: 2,
    delivered: 3,
    read: 4,
    failed: -1,
    expired: -1,
  };
  if (next === "failed" || next === "expired") return next;
  return rank[next] >= rank[current] ? next : current;
}

export type StructuredAlertKind =
  | "flood"
  | "fire"
  | "medical"
  | "missing_person"
  | "infrastructure"
  | "sos";

export type AlertPriority = "critical" | "high" | "normal";

export interface StructuredAlertLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
}

export interface StructuredAlert {
  schemaVersion: 1;
  alertId: string;
  kind: StructuredAlertKind;
  priority: AlertPriority;
  title: string;
  description: string;
  village: string;
  ward?: string;
  location?: StructuredAlertLocation;
  createdAt: number;
  expiresAt: number;
}

const STRUCTURED_ALERT_KINDS: StructuredAlertKind[] = ["flood", "fire", "medical", "missing_person", "infrastructure", "sos"];
const ALERT_PRIORITIES: AlertPriority[] = ["critical", "high", "normal"];

export function createStructuredAlert(input: Omit<StructuredAlert, "schemaVersion">): StructuredAlert {
  const alert: StructuredAlert = { schemaVersion: 1, ...input };
  validateStructuredAlert(alert);
  return alert;
}

export function serializeStructuredAlert(alert: StructuredAlert): string {
  validateStructuredAlert(alert);
  return JSON.stringify(alert);
}

export function parseStructuredAlert(body: string): StructuredAlert | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object") return null;
    const alert = parsed as Partial<StructuredAlert>;
    if (alert.schemaVersion !== 1) return null;
    validateStructuredAlert(alert as StructuredAlert);
    return alert as StructuredAlert;
  } catch {
    return null;
  }
}

export function validateStructuredAlert(alert: StructuredAlert): void {
  if (alert.schemaVersion !== 1) throw new Error("Unsupported structured alert schema");
  if (!alert.alertId || !STRUCTURED_ALERT_KINDS.includes(alert.kind)) throw new Error("Structured alert identity or kind is invalid");
  if (!ALERT_PRIORITIES.includes(alert.priority)) throw new Error("Structured alert priority is invalid");
  if (!alert.title.trim() || !alert.description.trim() || !alert.village.trim()) throw new Error("Structured alert text is incomplete");
  if (!Number.isFinite(alert.createdAt) || !Number.isFinite(alert.expiresAt) || alert.expiresAt <= alert.createdAt) throw new Error("Structured alert expiry is invalid");
  if (alert.location && (!Number.isFinite(alert.location.latitude) || !Number.isFinite(alert.location.longitude))) throw new Error("Structured alert location is invalid");
}

export interface RelayEventRecord {
  eventId: string;
  packetId: string;
  messageId?: string;
  kind: "received" | "forwarded" | "queued" | "expired" | "failed" | "delivered";
  peerId?: string;
  createdAt: number;
  detail?: string;
}

export interface AlertRecord {
  alert: StructuredAlert;
  messageId: string;
  packetId?: string;
  deliveryState: DeliveryState;
  updatedAt: number;
}

export interface AlertStore {
  list(): Promise<AlertRecord[]>;
  upsert(record: AlertRecord): Promise<void>;
  remove(messageId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface TrustedPeerRecord {
  peerId: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
  fingerprint: string;
  trustedAt: number;
}

export interface TrustedPeerStore {
  list(): Promise<TrustedPeerRecord[]>;
  get(peerId: string): Promise<TrustedPeerRecord | null>;
  upsert(record: TrustedPeerRecord): Promise<void>;
  remove(peerId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface RelayEventStore {
  list(): Promise<RelayEventRecord[]>;
  append(record: RelayEventRecord): Promise<void>;
  clear(): Promise<void>;
}
