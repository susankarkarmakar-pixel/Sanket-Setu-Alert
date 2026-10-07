import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import { Platform } from "react-native";
import type { AlertRecord, DeliveryState, OutboxRecord, RelayEventRecord } from "@sanketly/domain";
import { MAX_RELAY_QUEUE_ITEMS, type MeshPacket, type RelayQueueRecord } from "@sanketly/protocol";
import { generateMeshIdentity, type MeshIdentity } from "@sanketly/mesh-crypto";

const OUTBOX_KEY = "sanketly.outbox.v1";
const RELAY_QUEUE_KEY = "sanketly.relay-queue.v1";
const MESH_IDENTITY_KEY = "sanketly.mesh-identity.v1";
const ALERTS_KEY = "sanketly.alerts.v1";
const RELAY_EVENTS_KEY = "sanketly.relay-events.v1";
const DATABASE_KEY_KEY = "sanketly.local-database-key.v1";
const DATABASE_KEY_CREATED_MARKER = "sanketly.local-database-key-created.v1";
const DATABASE_NAME = "ssa-private-v1.db";
const DATABASE_SCHEMA_VERSION = 1;
const LEGACY_IMPORT_KEY = "async-storage-import-v1";
const MAX_RELAY_EVENTS = 1_024;
const DATABASE_KEY_PATTERN = /^[0-9a-f]{64}$/;
const LEGACY_KEYS = [OUTBOX_KEY, RELAY_QUEUE_KEY, ALERTS_KEY, RELAY_EVENTS_KEY] as const;
const DELIVERY_STATES: readonly DeliveryState[] = ["queued", "relaying", "sent", "delivered", "read", "expired", "failed"];
const RELAY_EVENT_KINDS: readonly RelayEventRecord["kind"][] = ["received", "forwarded", "queued", "expired", "failed", "delivered"];

let databasePromise: Promise<SQLiteDatabase> | null = null;

export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMeshIdentity(value: unknown): value is MeshIdentity {
  if (!isRecord(value)) return false;
  return [
    "peerId",
    "signingPublicKey",
    "signingPrivateKey",
    "encryptionPublicKey",
    "encryptionPrivateKey",
  ].every((key) => typeof value[key] === "string");
}

function isDeliveryState(value: unknown): value is DeliveryState {
  return typeof value === "string" && DELIVERY_STATES.includes(value as DeliveryState);
}

function isAlertRecord(value: unknown): value is AlertRecord {
  if (!isRecord(value) || !isRecord(value.alert)) return false;
  return typeof value.messageId === "string"
    && typeof value.updatedAt === "number"
    && typeof value.alert.alertId === "string"
    && typeof value.alert.title === "string"
    && typeof value.alert.description === "string"
    && typeof value.alert.village === "string"
    && isDeliveryState(value.deliveryState);
}

function isOutboxRecord(value: unknown): value is OutboxRecord {
  return isRecord(value)
    && typeof value.messageId === "string"
    && typeof value.conversationId === "string"
    && typeof value.senderId === "string"
    && typeof value.recipientId === "string"
    && typeof value.ciphertext === "string"
    && typeof value.createdAt === "number"
    && typeof value.expiresAt === "number"
    && isDeliveryState(value.deliveryState)
    && typeof value.attempts === "number";
}

function isMeshPacket(value: unknown): value is MeshPacket {
  return isRecord(value)
    && typeof value.packetId === "string"
    && typeof value.senderId === "string"
    && typeof value.createdAt === "number"
    && typeof value.expiresAt === "number";
}

function isRelayQueueRecord(value: unknown): value is RelayQueueRecord {
  return isRecord(value)
    && typeof value.queueId === "string"
    && isMeshPacket(value.packet)
    && typeof value.attempts === "number"
    && typeof value.nextAttemptAt === "number"
    && typeof value.enqueuedAt === "number";
}

function isRelayEventRecord(value: unknown): value is RelayEventRecord {
  return isRecord(value)
    && typeof value.eventId === "string"
    && typeof value.packetId === "string"
    && typeof value.createdAt === "number"
    && typeof value.kind === "string"
    && RELAY_EVENT_KINDS.includes(value.kind as RelayEventRecord["kind"]);
}

function parseLegacyList<T>(raw: string | null, guard: (value: unknown) => value is T, label: string): T[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Legacy ${label} data is corrupt; the original was preserved in AsyncStorage`);
  }
  if (!Array.isArray(parsed) || !parsed.every(guard)) {
    throw new Error(`Legacy ${label} data contains an invalid record; the original was preserved in AsyncStorage`);
  }
  return parsed;
}

function serialize(record: unknown): string {
  const value = JSON.stringify(record);
  if (typeof value !== "string") throw new Error("Unable to serialize local SSA record");
  return value;
}

function parseStoredRecord<T>(raw: string, guard: (value: unknown) => value is T, label: string): T {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (guard(parsed)) return parsed;
  } catch {
    // The caller receives an explicit error rather than silently losing a stored record.
  }
  throw new Error(`A stored ${label} record is invalid; local data was not deleted`);
}

function createDatabaseKey(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("Secure random generation is unavailable; encrypted local storage was not started");
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadOrCreateDatabaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DATABASE_KEY_KEY);
  if (existing !== null) {
    if (!DATABASE_KEY_PATTERN.test(existing)) throw new Error("The secure local database key is invalid; refusing to replace it");
    await AsyncStorage.setItem(DATABASE_KEY_CREATED_MARKER, "1");
    return existing;
  }

  const wasPreviouslyCreated = await AsyncStorage.getItem(DATABASE_KEY_CREATED_MARKER);
  if (wasPreviouslyCreated === "1") {
    throw new Error("The secure local database key is missing; refusing to create a replacement that could lock existing encrypted data");
  }

  const created = createDatabaseKey();
  await SecureStore.setItemAsync(DATABASE_KEY_KEY, created);
  await AsyncStorage.setItem(DATABASE_KEY_CREATED_MARKER, "1");
  return created;
}

function getDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openSecureDatabase().catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

async function openSecureDatabase(): Promise<SQLiteDatabase> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    throw new Error("Encrypted SSA storage requires the native Android or iOS app; plaintext fallback is disabled");
  }

  const key = await loadOrCreateDatabaseKey();
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  try {
    // SQLCipher must receive the key immediately after opening the database.
    // The key is generated locally and restricted to lowercase hexadecimal characters.
    await database.execAsync(`PRAGMA key = \"x'${key}'\"`);
    const cipher = await database.getFirstAsync<{ cipher_version?: string }>("PRAGMA cipher_version");
    if (!cipher?.cipher_version) {
      throw new Error("SQLCipher is unavailable in this app build; encrypted storage will not fall back to plain SQLite");
    }

    await database.execAsync("PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA journal_mode = WAL;");
    await migrateSchema(database);
    await importLegacyAsyncStorage(database);
    return database;
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    throw error;
  }
}

async function migrateSchema(database: SQLiteDatabase): Promise<void> {
  const row = await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = Number(row?.user_version ?? 0);
  if (!Number.isInteger(currentVersion) || currentVersion < 0) throw new Error("SSA local database schema version is invalid");
  if (currentVersion > DATABASE_SCHEMA_VERSION) {
    throw new Error(`SSA local database schema ${currentVersion} is newer than this app supports`);
  }

  for (let version = currentVersion + 1; version <= DATABASE_SCHEMA_VERSION; version += 1) {
    if (version === 1) {
      await database.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.execAsync(`
          CREATE TABLE IF NOT EXISTS storage_meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS alerts (
            message_id TEXT PRIMARY KEY NOT NULL,
            record_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS alerts_updated_at_idx ON alerts(updated_at DESC);
          CREATE TABLE IF NOT EXISTS outbox (
            message_id TEXT PRIMARY KEY NOT NULL,
            record_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS outbox_created_at_idx ON outbox(created_at ASC);
          CREATE TABLE IF NOT EXISTS relay_queue (
            queue_id TEXT PRIMARY KEY NOT NULL,
            record_json TEXT NOT NULL,
            enqueued_at INTEGER NOT NULL,
            next_attempt_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS relay_queue_retry_idx ON relay_queue(next_attempt_at ASC, enqueued_at ASC);
          CREATE TABLE IF NOT EXISTS relay_events (
            event_id TEXT PRIMARY KEY NOT NULL,
            record_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS relay_events_created_at_idx ON relay_events(created_at ASC);
        `);
        await transaction.execAsync(`PRAGMA user_version = ${version}`);
      });
    }
  }
}

async function importLegacyAsyncStorage(database: SQLiteDatabase): Promise<void> {
  const marker = await database.getFirstAsync<{ value: string }>("SELECT value FROM storage_meta WHERE key = ?", LEGACY_IMPORT_KEY);
  const stored = await AsyncStorage.multiGet([...LEGACY_KEYS]);
  const legacy = new Map(stored);
  const hasLegacyData = LEGACY_KEYS.some((key) => legacy.get(key) !== null && legacy.get(key) !== undefined);
  if (marker?.value === "done" && !hasLegacyData) {
    await AsyncStorage.multiRemove([...LEGACY_KEYS]);
    return;
  }

  const alerts = parseLegacyList(legacy.get(ALERTS_KEY) ?? null, isAlertRecord, "alert");
  const outbox = parseLegacyList(legacy.get(OUTBOX_KEY) ?? null, isOutboxRecord, "outbox");
  const relayQueue = parseLegacyList(legacy.get(RELAY_QUEUE_KEY) ?? null, isRelayQueueRecord, "relay queue");
  const relayEvents = parseLegacyList(legacy.get(RELAY_EVENTS_KEY) ?? null, isRelayEventRecord, "relay event");

  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const record of alerts) await upsertAlert(transaction, record);
    for (const record of outbox) await upsertOutbox(transaction, record);
    for (const record of relayQueue) await upsertRelayQueue(transaction, record);
    for (const record of relayEvents) await insertRelayEvent(transaction, record);
    await transaction.runAsync("INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", LEGACY_IMPORT_KEY, "done");
  });

  // Remove plaintext legacy copies only after their encrypted SQLite transaction commits.
  // If cleanup fails, startup fails closed; the import marker makes retry safe and idempotent.
  try {
    await AsyncStorage.multiRemove([...LEGACY_KEYS]);
  } catch {
    throw new Error("Encrypted migration completed, but legacy plaintext cleanup failed; local storage is unavailable until cleanup succeeds");
  }
}

async function upsertAlert(database: SQLiteDatabase, record: AlertRecord): Promise<void> {
  await database.runAsync(
    "INSERT INTO alerts (message_id, record_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET record_json = excluded.record_json, updated_at = excluded.updated_at",
    record.messageId,
    serialize(record),
    record.updatedAt,
  );
}

async function upsertOutbox(database: SQLiteDatabase, record: OutboxRecord): Promise<void> {
  await database.runAsync(
    "INSERT INTO outbox (message_id, record_json, created_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET record_json = excluded.record_json, created_at = excluded.created_at, expires_at = excluded.expires_at",
    record.messageId,
    serialize(record),
    record.createdAt,
    record.expiresAt,
  );
}

async function upsertRelayQueue(database: SQLiteDatabase, record: RelayQueueRecord): Promise<void> {
  await database.runAsync(
    "INSERT INTO relay_queue (queue_id, record_json, enqueued_at, next_attempt_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(queue_id) DO UPDATE SET record_json = excluded.record_json, enqueued_at = excluded.enqueued_at, next_attempt_at = excluded.next_attempt_at, expires_at = excluded.expires_at",
    record.queueId,
    serialize(record),
    record.enqueuedAt,
    record.nextAttemptAt,
    record.packet.expiresAt,
  );
}

async function insertRelayEvent(database: SQLiteDatabase, record: RelayEventRecord): Promise<void> {
  await database.runAsync(
    "INSERT OR IGNORE INTO relay_events (event_id, record_json, created_at) VALUES (?, ?, ?)",
    record.eventId,
    serialize(record),
    record.createdAt,
  );
}

async function readRows<T>(rows: Array<{ record_json: string }>, guard: (value: unknown) => value is T, label: string): Promise<T[]> {
  return rows.map((row) => parseStoredRecord(row.record_json, guard, label));
}

export async function loadMeshIdentity(): Promise<MeshIdentity> {
  const existing = await SecureStore.getItemAsync(MESH_IDENTITY_KEY);
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (isMeshIdentity(parsed)) return parsed;
    } catch {
      // Corrupt identity records are replaced with a new identity below.
    }
  }
  const created = await generateMeshIdentity();
  await SecureStore.setItemAsync(MESH_IDENTITY_KEY, JSON.stringify(created));
  return created;
}

export async function loadPeerId(): Promise<string> {
  return (await loadMeshIdentity()).peerId;
}

export async function loadOutbox(): Promise<OutboxRecord[]> {
  return new MobileOutboxStore().list();
}

export async function saveOutbox(records: OutboxRecord[]): Promise<void> {
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync("DELETE FROM outbox");
    for (const record of records) await upsertOutbox(transaction, record);
  });
}

export class MobileRelayQueueStore {
  async list(): Promise<RelayQueueRecord[]> {
    const database = await getDatabase();
    const rows = await database.getAllAsync<{ record_json: string }>("SELECT record_json FROM relay_queue ORDER BY enqueued_at ASC, queue_id ASC");
    return readRows(rows, isRelayQueueRecord, "relay queue");
  }

  async upsert(record: RelayQueueRecord): Promise<void> {
    const database = await getDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await upsertRelayQueue(transaction, record);
      await transaction.runAsync(
        "DELETE FROM relay_queue WHERE queue_id IN (SELECT queue_id FROM relay_queue ORDER BY enqueued_at DESC, queue_id DESC LIMIT -1 OFFSET ?)",
        MAX_RELAY_QUEUE_ITEMS,
      );
    });
  }

  async remove(queueId: string): Promise<void> {
    const database = await getDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync("DELETE FROM relay_queue WHERE queue_id = ?", queueId);
    });
  }

  async clear(): Promise<void> {
    const database = await getDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync("DELETE FROM relay_queue");
    });
  }
}

export class MobileAlertStore {
  async list(): Promise<AlertRecord[]> {
    const database = await getDatabase();
    const rows = await database.getAllAsync<{ record_json: string }>("SELECT record_json FROM alerts ORDER BY updated_at DESC, message_id ASC");
    return readRows(rows, isAlertRecord, "alert");
  }

  async upsert(record: AlertRecord): Promise<void> {
    const database = await getDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await upsertAlert(transaction, record);
    });
  }

  async remove(messageId: string): Promise<void> {
    const database = await getDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync("DELETE FROM alerts WHERE message_id = ?", messageId);
    });
  }

  async clear(): Promise<void> {
    const database = await getDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync("DELETE FROM alerts");
    });
  }
}

export class MobileRelayEventStore {
  async list(): Promise<RelayEventRecord[]> {
    const database = await getDatabase();
    const rows = await database.getAllAsync<{ record_json: string }>("SELECT record_json FROM relay_events ORDER BY created_at ASC, event_id ASC");
    return readRows(rows, isRelayEventRecord, "relay event");
  }

  async append(record: RelayEventRecord): Promise<void> {
    const database = await getDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await insertRelayEvent(transaction, record);
      await transaction.runAsync(
        "DELETE FROM relay_events WHERE event_id IN (SELECT event_id FROM relay_events ORDER BY created_at DESC, event_id DESC LIMIT -1 OFFSET ?)",
        MAX_RELAY_EVENTS,
      );
    });
  }

  async clear(): Promise<void> {
    const database = await getDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync("DELETE FROM relay_events");
    });
  }
}

export class MobileOutboxStore {
  async list(): Promise<OutboxRecord[]> {
    const database = await getDatabase();
    const rows = await database.getAllAsync<{ record_json: string }>("SELECT record_json FROM outbox ORDER BY created_at ASC, message_id ASC");
    return readRows(rows, isOutboxRecord, "outbox");
  }

  async upsert(record: OutboxRecord): Promise<void> {
    const database = await getDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await upsertOutbox(transaction, record);
    });
  }

  async remove(messageId: string): Promise<void> {
    const database = await getDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync("DELETE FROM outbox WHERE message_id = ?", messageId);
    });
  }

  async clear(): Promise<void> {
    const database = await getDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync("DELETE FROM outbox");
    });
  }
}
