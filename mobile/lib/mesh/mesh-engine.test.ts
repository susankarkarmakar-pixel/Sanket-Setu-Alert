import { describe, expect, it } from "vitest";
import { createAnnouncePacket, createMessagePacket, encodePacket, type MeshPeer, type RelayQueueRecord } from "@sanketly/protocol";
import { MeshEngine } from "./mesh-engine";

function peer(peerId: string, linkId: string, verified = true): MeshPeer {
  return {
    peerId,
    linkId,
    displayName: peerId,
    lastSeenAt: 1_000,
    verified,
    connectionState: "connected",
    transport: "nearby",
  };
}

function testIdentity(peerId: string) {
  return {
    peerId,
    signingPublicKey: "signing-public",
    signingPrivateKey: "signing-private",
    encryptionPublicKey: "encryption-public",
    encryptionPrivateKey: "encryption-private",
  };
}

function createStore(initial: RelayQueueRecord[] = []) {
  const records = [...initial];
  return {
    records,
    list: async () => [...records],
    upsert: async (record: RelayQueueRecord) => {
      const index = records.findIndex((entry) => entry.queueId === record.queueId);
      if (index === -1) records.push(record);
      else records[index] = record;
    },
    remove: async (queueId: string) => {
      const index = records.findIndex((entry) => entry.queueId === queueId);
      if (index !== -1) records.splice(index, 1);
    },
  };
}

describe("MeshEngine", () => {
  it("forwards an announce packet to the next connected peer", async () => {
    const sent: Array<{ linkId: string; bytes: number[] }> = [];
    const relays: string[] = [];
    const store = createStore();
    const engine = new MeshEngine({
      identity: testIdentity("relay-b"),
      relayStore: store,
      now: () => 1_000,
      send: async (linkId, bytes) => { sent.push({ linkId, bytes }); },
      events: {
        onMessage: () => undefined,
        onPacket: () => undefined,
        onRelay: (_packet, viaPeer) => relays.push(viaPeer.peerId),
        onQueued: () => undefined,
        onError: (error) => { throw error; },
      },
    });
    const packet = createAnnouncePacket({ packetId: "announce-a", senderId: "device-a", payload: "keys", now: 1_000, ttlMs: 30_000, hopLimit: 2 });

    await engine.receive("link-a", Array.from(encodePacket(packet)), [peer("device-a", "link-a"), peer("device-c", "link-c", false)]);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.linkId).toBe("link-c");
    expect(relays).toEqual(["device-c"]);
    expect(store.records).toHaveLength(0);
  });

  it("suppresses duplicate packet IDs at the relay boundary", async () => {
    let sends = 0;
    const engine = new MeshEngine({
      identity: testIdentity("relay-b"),
      relayStore: createStore(),
      now: () => 1_000,
      send: async () => { sends += 1; },
      events: { onMessage: () => undefined, onPacket: () => undefined, onRelay: () => undefined, onQueued: () => undefined, onError: (error) => { throw error; } },
    });
    const packet = createAnnouncePacket({ packetId: "duplicate", senderId: "device-a", payload: "keys", now: 1_000, ttlMs: 30_000, hopLimit: 2 });
    const bytes = Array.from(encodePacket(packet));

    await engine.receive("link-a", bytes, [peer("device-c", "link-c", false)]);
    await engine.receive("link-a", bytes, [peer("device-c", "link-c", false)]);

    expect(sends).toBe(1);
  });

  it("persists a packet when no relay is available and drains it later", async () => {
    let now = 1_000;
    const sent: string[] = [];
    const store = createStore();
    const engine = new MeshEngine({
      identity: testIdentity("relay-b"),
      relayStore: store,
      now: () => now,
      send: async (linkId) => { sent.push(linkId); },
      events: { onMessage: () => undefined, onPacket: () => undefined, onRelay: () => undefined, onQueued: () => undefined, onError: (error) => { throw error; } },
    });
    const packet = createAnnouncePacket({ packetId: "queued", senderId: "device-a", payload: "keys", now: 1_000, ttlMs: 30_000, hopLimit: 2 });

    const result = await engine.receive("link-a", Array.from(encodePacket(packet)), []);
    expect(result).toBeUndefined();
    expect(store.records).toHaveLength(1);

    now = 4_000;
    await engine.drain([peer("device-c", "link-c", false)]);
    expect(sent).toEqual(["link-c"]);
    expect(store.records).toHaveLength(0);
  });

  it("does not decrypt or deliver a direct message from an untrusted key", async () => {
    const errors: string[] = [];
    let delivered = 0;
    const engine = new MeshEngine({
      identity: testIdentity("local-peer"),
      relayStore: createStore(),
      now: () => 1_000,
      send: async () => undefined,
      isTrustedSender: async () => false,
      events: {
        onMessage: () => { delivered += 1; },
        onPacket: () => undefined,
        onRelay: () => undefined,
        onQueued: () => undefined,
        onError: (error) => errors.push(error.message),
      },
    });
    const packet = createMessagePacket({
      packetId: "untrusted-packet",
      messageId: "untrusted-message",
      senderId: "attacker-peer",
      recipientId: "local-peer",
      conversationId: "dm:local-peer",
      ciphertext: "opaque",
      signature: "invalid",
      cryptoVersion: 1,
      senderSigningPublicKey: "untrusted-signing-key",
      senderEncryptionPublicKey: "untrusted-encryption-key",
      now: 1_000,
      ttlMs: 10_000,
    });

    await engine.receive("untrusted-link", Array.from(encodePacket(packet)), []);

    expect(delivered).toBe(0);
    expect(errors).toContain("Message sender identity is not trusted on this device");
  });
});
