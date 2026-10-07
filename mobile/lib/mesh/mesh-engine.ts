import { decryptMeshPacket, verifyAcknowledgementPacket, type DecryptedMeshMessage, type MeshIdentity } from "@sanketly/mesh-crypto";
import {
  canRelay,
  decodePacket,
  encodePacket,
  MAX_RELAY_ATTEMPTS,
  nextRelayAttemptAt,
  relayPacket,
  selectNextHop,
  shouldRelayPacket,
  DeduplicationCache,
  type MeshPacket,
  type MeshPeer,
  type RelayQueueRecord,
} from "@sanketly/protocol";

export interface MeshRelayStore {
  list(): Promise<RelayQueueRecord[]>;
  upsert(record: RelayQueueRecord): Promise<void>;
  remove(queueId: string): Promise<void>;
}

export interface MeshEngineEvents {
  onMessage(message: DecryptedMeshMessage, packet: MeshPacket): void;
  onAcknowledgement?(packet: MeshPacket): void;
  onPacket(packet: MeshPacket, linkId: string): void;
  onRelay(packet: MeshPacket, viaPeer: MeshPeer): void;
  onQueued(packet: MeshPacket): void;
  onError(error: Error, packet?: MeshPacket): void;
}

export interface MeshEngineOptions {
  identity: MeshIdentity;
  relayStore: MeshRelayStore;
  send(linkId: string, bytes: number[]): Promise<void>;
  isTrustedSender?(packet: MeshPacket): Promise<boolean> | boolean;
  events: MeshEngineEvents;
  now?: () => number;
  deduplication?: DeduplicationCache;
}

export type MeshSendResult =
  | { state: "sent"; peer: MeshPeer }
  | { state: "queued"; packet: MeshPacket }
  | { state: "expired"; packet: MeshPacket };

/**
 * Transport-independent mesh orchestration. Native modules only need to expose
 * a link ID and a byte send function; routing and packet semantics stay here.
 */
export class MeshEngine {
  private readonly now: () => number;
  private readonly seen: DeduplicationCache;

  constructor(private readonly options: MeshEngineOptions) {
    this.now = options.now ?? (() => Date.now());
    this.seen = options.deduplication ?? new DeduplicationCache();
  }

  async send(packet: MeshPacket, peers: MeshPeer[], incomingLinkId?: string): Promise<MeshSendResult> {
    if (packet.expiresAt <= this.now()) {
      return { state: "expired", packet };
    }
    return this.sendOrQueue(packet, peers, incomingLinkId);
  }

  async receive(linkId: string, bytes: number[], peers: MeshPeer[]): Promise<void> {
    let packet: MeshPacket | undefined;
    try {
      packet = decodePacket(Uint8Array.from(bytes));
      if (!this.seen.remember(packet.packetId, this.now())) return;
      this.options.events.onPacket(packet, linkId);

      if (packet.type === "message" && packet.recipientId === this.options.identity.peerId) {
        if (this.options.isTrustedSender && !(await this.options.isTrustedSender(packet))) {
          throw new Error("Message sender identity is not trusted on this device");
        }
        const message = await decryptMeshPacket({ identity: this.options.identity, packet, now: this.now() });
        this.options.events.onMessage(message, packet);
        return;
      }

      if (packet.type === "ack" && packet.recipientId === this.options.identity.peerId) {
        if (this.options.isTrustedSender && !(await this.options.isTrustedSender(packet))) {
          throw new Error("Acknowledgement sender identity is not trusted on this device");
        }
        verifyAcknowledgementPacket({ packet, expectedRecipientId: this.options.identity.peerId, now: this.now() });
        this.options.events.onAcknowledgement?.(packet);
        return;
      }

      if (packet.type !== "message" && packet.type !== "announce" && packet.type !== "ack") return;
      if (!shouldRelayPacket(packet, this.options.identity.peerId, this.now())) return;
      const relayedPacket = relayPacket(packet, this.options.identity.peerId, this.now());
      await this.sendOrQueue(relayedPacket, peers, linkId);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error("Invalid mesh packet");
      this.options.events.onError(normalized, packet);
    }
  }

  async drain(peers: MeshPeer[]): Promise<void> {
    const now = this.now();
    for (const record of await this.options.relayStore.list()) {
      if (record.packet.expiresAt <= now) {
        await this.options.relayStore.remove(record.queueId);
        continue;
      }
      if (record.nextAttemptAt > now) continue;
      const route = selectNextHop(record.packet, peers, { localPeerId: this.options.identity.peerId, now });
      if (!route?.linkId) continue;
      try {
        await this.options.send(route.linkId, Array.from(encodePacket(record.packet)));
        await this.options.relayStore.remove(record.queueId);
        this.options.events.onRelay(record.packet, route);
      } catch (error) {
        const attempts = record.attempts + 1;
        if (attempts >= MAX_RELAY_ATTEMPTS) {
          await this.options.relayStore.remove(record.queueId);
        } else {
          await this.options.relayStore.upsert({
            ...record,
            attempts,
            nextAttemptAt: nextRelayAttemptAt(attempts, now),
            lastError: error instanceof Error ? error.message : "Relay link failed",
          });
        }
      }
    }
  }

  private async sendOrQueue(packet: MeshPacket, peers: MeshPeer[], incomingLinkId?: string): Promise<MeshSendResult> {
    const now = this.now();
    if (packet.expiresAt <= now) {
      return { state: "expired", packet };
    }
    const route = selectNextHop(packet, peers, { localPeerId: this.options.identity.peerId, excludeLinkId: incomingLinkId, now });
    if (route?.linkId) {
      try {
        await this.options.send(route.linkId, Array.from(encodePacket(packet)));
        this.options.events.onRelay(packet, route);
        return { state: "sent", peer: route };
      } catch (error) {
        this.options.events.onError(error instanceof Error ? error : new Error("Mesh link failed"), packet);
      }
    }

    const current = (await this.options.relayStore.list()).find((entry) => entry.packet.packetId === packet.packetId);
    const attempts = current?.attempts ?? 0;
    if (attempts >= MAX_RELAY_ATTEMPTS || packet.hopCount >= packet.hopLimit) return { state: "expired", packet };
    await this.options.relayStore.upsert({
      queueId: `${packet.packetId}:${this.options.identity.peerId}`,
      packet,
      attempts,
      nextAttemptAt: nextRelayAttemptAt(attempts, now),
      enqueuedAt: current?.enqueuedAt ?? now,
      lastError: current?.lastError,
    });
    this.options.events.onQueued(packet);
    return { state: "queued", packet };
  }
}
