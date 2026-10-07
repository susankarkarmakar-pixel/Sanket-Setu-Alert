import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type TableName = "alerts" | "outbox" | "relay_queue" | "relay_events";
  const tableNames: TableName[] = ["alerts", "outbox", "relay_queue", "relay_events"];
  const state = {
    legacy: new Map<string, string>(),
    secure: new Map<string, string>(),
    metadata: new Map<string, string>(),
    tables: {
      alerts: new Map<string, Record<string, unknown>>(),
      outbox: new Map<string, Record<string, unknown>>(),
      relay_queue: new Map<string, Record<string, unknown>>(),
      relay_events: new Map<string, Record<string, unknown>>(),
    },
    cipherEnabled: true,
    schemaVersion: 0,
    executedSql: [] as string[],
    reset() {
      this.legacy.clear();
      this.secure.clear();
      this.metadata.clear();
      for (const table of tableNames) this.tables[table].clear();
      this.cipherEnabled = true;
      this.schemaVersion = 0;
      this.executedSql.length = 0;
    },
  };

  const database: Record<string, any> = {
    async execAsync(sql: string) {
      state.executedSql.push(sql);
      const version = sql.match(/PRAGMA\s+user_version\s*=\s*(\d+)/i);
      if (version) state.schemaVersion = Number(version[1]);
      for (const table of tableNames) {
        if (new RegExp(`DELETE\\s+FROM\\s+${table}(?:\\s*;|\\s*$)`, "i").test(sql.trim())) state.tables[table].clear();
      }
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      if (/PRAGMA\s+cipher_version/i.test(sql)) {
        return state.cipherEnabled ? ({ cipher_version: "4.8.0" } as T) : null;
      }
      if (/PRAGMA\s+user_version/i.test(sql)) return { user_version: state.schemaVersion } as T;
      if (/FROM\s+storage_meta/i.test(sql)) {
        const value = state.metadata.get(String(params[0]));
        return value === undefined ? null : ({ value } as T);
      }
      return null;
    },
    async getAllAsync<T>(sql: string): Promise<T[]> {
      const table = tableNames.find((name) => new RegExp(`FROM\\s+${name}\\b`, "i").test(sql));
      return table ? [...state.tables[table].values()] as T[] : [];
    },
    async runAsync(sql: string, ...params: unknown[]) {
      if (/INSERT\s+INTO\s+storage_meta/i.test(sql)) {
        state.metadata.set(String(params[0]), String(params[1]));
        return { changes: 1, lastInsertRowId: 1 };
      }

      const table = tableNames.find((name) => new RegExp(`INTO\\s+${name}\\b`, "i").test(sql));
      if (table) {
        const fields: Record<TableName, string[]> = {
          alerts: ["message_id", "record_json", "updated_at"],
          outbox: ["message_id", "record_json", "created_at", "expires_at"],
          relay_queue: ["queue_id", "record_json", "enqueued_at", "next_attempt_at", "expires_at"],
          relay_events: ["event_id", "record_json", "created_at"],
        };
        const row = Object.fromEntries(fields[table].map((field, index) => [field, params[index]]));
        const keyField = table === "alerts" ? "message_id" : table === "outbox" ? "message_id" : table === "relay_queue" ? "queue_id" : "event_id";
        const key = String(row[keyField]);
        if (/INSERT\s+OR\s+IGNORE/i.test(sql) && state.tables[table].has(key)) return { changes: 0, lastInsertRowId: 0 };
        state.tables[table].set(key, row);
        return { changes: 1, lastInsertRowId: 1 };
      }

      if (/DELETE\s+FROM\s+relay_queue\s+WHERE\s+queue_id\s*=\s*\?/i.test(sql)) state.tables.relay_queue.delete(String(params[0]));
      if (/DELETE\s+FROM\s+alerts\s+WHERE\s+message_id\s*=\s*\?/i.test(sql)) state.tables.alerts.delete(String(params[0]));
      if (/DELETE\s+FROM\s+outbox\s+WHERE\s+message_id\s*=\s*\?/i.test(sql)) state.tables.outbox.delete(String(params[0]));
      return { changes: 1, lastInsertRowId: 1 };
    },
    async withExclusiveTransactionAsync(task: (transaction: Record<string, any>) => Promise<void>) {
      const snapshot = {
        schemaVersion: state.schemaVersion,
        metadata: new Map(state.metadata),
        tables: Object.fromEntries(tableNames.map((name) => [name, new Map(state.tables[name])])) as typeof state.tables,
      };
      try {
        await task(database);
      } catch (error) {
        state.schemaVersion = snapshot.schemaVersion;
        state.metadata.clear();
        for (const [key, value] of snapshot.metadata) state.metadata.set(key, value);
        for (const table of tableNames) {
          state.tables[table].clear();
          for (const [key, value] of snapshot.tables[table]) state.tables[table].set(key, value);
        }
        throw error;
      }
    },
    async closeAsync() {},
  };

  const asyncStorage = {
    async getItem(key: string) { return state.legacy.get(key) ?? null; },
    async setItem(key: string, value: string) { state.legacy.set(key, value); },
    async multiGet(keys: string[]) { return keys.map((key) => [key, state.legacy.get(key) ?? null] as [string, string | null]); },
    async multiRemove(keys: string[]) { for (const key of keys) state.legacy.delete(key); },
  };

  return { state, database, asyncStorage };
});

vi.mock("@react-native-async-storage/async-storage", () => ({ default: mocks.asyncStorage }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => mocks.state.secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { mocks.state.secure.set(key, value); },
}));
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: async () => mocks.database }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

const LEGACY = {
  outbox: "sanketly.outbox.v1",
  relayQueue: "sanketly.relay-queue.v1",
  alerts: "sanketly.alerts.v1",
  relayEvents: "sanketly.relay-events.v1",
};

function sampleAlertRecord() {
  return {
    alert: {
      schemaVersion: 1 as const,
      alertId: "alert-1",
      kind: "flood" as const,
      priority: "critical" as const,
      title: "Flood warning",
      description: "Water rising",
      village: "Gazole",
      createdAt: 100,
      expiresAt: 10_000,
    },
    messageId: "message-1",
    packetId: "packet-1",
    deliveryState: "queued" as const,
    updatedAt: 200,
  };
}

function sampleOutboxRecord() {
  return {
    messageId: "message-1",
    conversationId: "dm:peer-1",
    senderId: "peer-local",
    recipientId: "peer-1",
    ciphertext: "opaque-ciphertext",
    createdAt: 100,
    expiresAt: 10_000,
    deliveryState: "queued" as const,
    attempts: 0,
  };
}

async function loadStorageModule() {
  vi.resetModules();
  return import("./storage");
}

describe("encrypted local storage", () => {
  beforeEach(() => {
    mocks.state.reset();
  });

  it("imports legacy alert, outbox, relay and event rows, then removes plaintext copies", async () => {
    const alert = sampleAlertRecord();
    const outbox = sampleOutboxRecord();
    const relayQueue = {
      queueId: "queue-1",
      packet: { packetId: "packet-1", senderId: "peer-local", createdAt: 100, expiresAt: 10_000 },
      attempts: 0,
      nextAttemptAt: 200,
      enqueuedAt: 150,
    };
    const relayEvent = { eventId: "event-1", packetId: "packet-1", kind: "queued", createdAt: 150 };
    mocks.state.legacy.set(LEGACY.alerts, JSON.stringify([alert]));
    mocks.state.legacy.set(LEGACY.outbox, JSON.stringify([outbox]));
    mocks.state.legacy.set(LEGACY.relayQueue, JSON.stringify([relayQueue]));
    mocks.state.legacy.set(LEGACY.relayEvents, JSON.stringify([relayEvent]));

    const { MobileAlertStore, MobileOutboxStore, MobileRelayQueueStore, MobileRelayEventStore } = await loadStorageModule();

    await expect(new MobileAlertStore().list()).resolves.toEqual([alert]);
    await expect(new MobileOutboxStore().list()).resolves.toEqual([outbox]);
    await expect(new MobileRelayQueueStore().list()).resolves.toEqual([relayQueue]);
    await expect(new MobileRelayEventStore().list()).resolves.toEqual([relayEvent]);
    expect(mocks.state.legacy.size).toBe(1);
    expect(mocks.state.legacy.get("sanketly.local-database-key-created.v1")).toBe("1");
    expect(mocks.state.schemaVersion).toBe(1);
    expect(mocks.state.secure.get("sanketly.local-database-key.v1")).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.state.executedSql[0]).toMatch(/^PRAGMA key/);
  });

  it("uses transactional idempotent upserts and supports removal", async () => {
    const { MobileAlertStore, MobileOutboxStore } = await loadStorageModule();
    const alertStore = new MobileAlertStore();
    const outboxStore = new MobileOutboxStore();
    const alert = sampleAlertRecord();
    const outbox = sampleOutboxRecord();

    await alertStore.upsert(alert);
    await alertStore.upsert({ ...alert, deliveryState: "delivered", updatedAt: 300 });
    await outboxStore.upsert(outbox);

    await expect(alertStore.list()).resolves.toEqual([{ ...alert, deliveryState: "delivered", updatedAt: 300 }]);
    await expect(outboxStore.list()).resolves.toEqual([outbox]);
    await alertStore.remove(alert.messageId);
    await outboxStore.remove(outbox.messageId);
    await expect(alertStore.list()).resolves.toEqual([]);
    await expect(outboxStore.list()).resolves.toEqual([]);
  });

  it("fails closed when SQLCipher is unavailable and preserves the legacy source data", async () => {
    mocks.state.cipherEnabled = false;
    mocks.state.legacy.set(LEGACY.alerts, JSON.stringify([sampleAlertRecord()]));
    const { MobileAlertStore } = await loadStorageModule();

    await expect(new MobileAlertStore().list()).rejects.toThrow("SQLCipher is unavailable");
    expect(mocks.state.legacy.has(LEGACY.alerts)).toBe(true);
    expect(mocks.state.executedSql.some((sql) => /CREATE TABLE/i.test(sql))).toBe(false);
  });

  it("does not delete legacy plaintext when a record cannot be migrated safely", async () => {
    mocks.state.legacy.set(LEGACY.outbox, JSON.stringify([{ messageId: "incomplete-record" }]));
    const { MobileOutboxStore } = await loadStorageModule();

    await expect(new MobileOutboxStore().list()).rejects.toThrow("Legacy outbox data contains an invalid record");
    expect(mocks.state.legacy.has(LEGACY.outbox)).toBe(true);
    expect(mocks.state.metadata.has("async-storage-import-v1")).toBe(false);
  });

  it("re-imports legacy records recreated by an older app version", async () => {
    const { MobileAlertStore } = await loadStorageModule();
    await new MobileAlertStore().list();
    const outbox = sampleOutboxRecord();
    mocks.state.legacy.set(LEGACY.outbox, JSON.stringify([outbox]));
    const { MobileOutboxStore } = await loadStorageModule();

    await expect(new MobileOutboxStore().list()).resolves.toEqual([outbox]);
    expect(mocks.state.legacy.has(LEGACY.outbox)).toBe(false);
  });

  it("does not replace a missing database key when the recovery marker exists", async () => {
    mocks.state.legacy.set("sanketly.local-database-key-created.v1", "1");
    const { MobileAlertStore } = await loadStorageModule();

    await expect(new MobileAlertStore().list()).rejects.toThrow("refusing to create a replacement");
    expect(mocks.state.secure.has("sanketly.local-database-key.v1")).toBe(false);
    expect(mocks.state.executedSql).toEqual([]);
  });
});
