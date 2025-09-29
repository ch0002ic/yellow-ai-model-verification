import { randomUUID } from "node:crypto";

import type {
  RPCBalance,
  RPCChannelUpdate,
} from "@erc7824/nitrolite/dist/rpc/types/index.js";

import type {
  ChannelEventRow,
  ClearNodeEventRepository,
  PersistedSnapshot,
} from "../persistence/ClearNodeEventRepository.js";
import logger from "../utils/logger.js";

export type Timestamped<T> = {
  id: string;
  updatedAt: Date;
  payload: T;
};

export type ChannelEventsSnapshot = {
  channels: Timestamped<RPCChannelUpdate>[];
  batches: Timestamped<RPCChannelUpdate[]>[];
  balances: Timestamped<RPCBalance[]>[];
};

export type ChannelEventStoreUpdate =
  | {
      type: "channel";
      channelId: string;
      occurredAt: string;
      snapshot: ChannelEventsSnapshot;
    }
  | {
      type: "channels";
      count: number;
      occurredAt: string;
      snapshot: ChannelEventsSnapshot;
    }
  | {
      type: "balance";
      count: number;
      occurredAt: string;
      snapshot: ChannelEventsSnapshot;
    };

const MAX_ENTRIES = 100;

const normaliseChannelId = (update: RPCChannelUpdate) => {
  if (typeof update !== "object" || update === null) {
    return "unknown";
  }

  if ("channelId" in update && typeof update.channelId === "string") {
    return update.channelId;
  }

  if ("channel_id" in update && typeof (update as { channel_id?: unknown }).channel_id === "string") {
    return (update as { channel_id: string }).channel_id;
  }

  if ("id" in update && typeof update.id === "string") {
    return update.id;
  }

  return "unknown";
};

export class ChannelEventStore {
  private readonly channelUpdates = new Map<string, Timestamped<RPCChannelUpdate>>();
  private readonly channelUpdateHistory: Timestamped<RPCChannelUpdate[]>[] = [];
  private readonly balanceUpdates: Timestamped<RPCBalance[]>[] = [];
  private readonly repository?: ClearNodeEventRepository;
  private readonly listeners = new Set<(update: ChannelEventStoreUpdate) => void>();

  constructor(repository?: ClearNodeEventRepository) {
    this.repository = repository;

    if (this.repository) {
      this.hydrateFromPersistence(this.repository.fetchSnapshot());
    }
  }

  public recordChannelUpdate(update: RPCChannelUpdate): void {
    const channelId = normaliseChannelId(update);
    const entry: Timestamped<RPCChannelUpdate> = {
      id: channelId,
      updatedAt: new Date(),
      payload: update,
    };

    this.channelUpdates.set(channelId, entry);
    this.trimMap();
    this.persistEvents([
      {
        id: entry.id,
        type: "channel",
        payload: JSON.stringify(update),
        occurredAt: entry.updatedAt.toISOString(),
        channelId,
      },
    ]);

    this.notify({
      type: "channel",
      channelId,
      occurredAt: entry.updatedAt.toISOString(),
      snapshot: this.snapshot(),
    });
  }

  public recordChannelsUpdate(updates: RPCChannelUpdate[]): void {
    const entry: Timestamped<RPCChannelUpdate[]> = {
      id: randomUUID(),
      updatedAt: new Date(),
      payload: updates,
    };

    this.channelUpdateHistory.unshift(entry);
    this.trimArray(this.channelUpdateHistory);

    for (const update of updates) {
      this.recordChannelUpdate(update);
    }

    this.persistEvents([
      {
        id: entry.id,
        type: "channels",
        payload: JSON.stringify(updates),
        occurredAt: entry.updatedAt.toISOString(),
      },
    ]);

    this.notify({
      type: "channels",
      count: updates.length,
      occurredAt: entry.updatedAt.toISOString(),
      snapshot: this.snapshot(),
    });
  }

  public recordBalanceUpdate(balances: RPCBalance[]): void {
    const entry: Timestamped<RPCBalance[]> = {
      id: randomUUID(),
      updatedAt: new Date(),
      payload: balances,
    };

    this.balanceUpdates.unshift(entry);
    this.trimArray(this.balanceUpdates);
    this.persistEvents([
      {
        id: entry.id,
        type: "balance",
        payload: JSON.stringify(balances),
        occurredAt: entry.updatedAt.toISOString(),
      },
    ]);

    this.notify({
      type: "balance",
      count: balances.length,
      occurredAt: entry.updatedAt.toISOString(),
      snapshot: this.snapshot(),
    });
  }

  public snapshot(): ChannelEventsSnapshot {
    return {
      channels: Array.from(this.channelUpdates.values()).sort((a, b) =>
        b.updatedAt.getTime() - a.updatedAt.getTime(),
      ),
      batches: [...this.channelUpdateHistory],
      balances: [...this.balanceUpdates],
    };
  }

  private trimMap() {
    if (this.channelUpdates.size <= MAX_ENTRIES) {
      return;
    }

    const sorted = Array.from(this.channelUpdates.values()).sort((a, b) =>
      b.updatedAt.getTime() - a.updatedAt.getTime(),
    );

    this.channelUpdates.clear();

    for (const entry of sorted.slice(0, MAX_ENTRIES)) {
      this.channelUpdates.set(entry.id, entry);
    }
  }

  private trimArray<T>(entries: Timestamped<T>[]) {
    if (entries.length <= MAX_ENTRIES) {
      return;
    }

    entries.length = MAX_ENTRIES;
  }

  private hydrateFromPersistence(snapshot: PersistedSnapshot) {
    for (const channel of snapshot.channels) {
      try {
        const payload = JSON.parse(channel.payload) as RPCChannelUpdate;
        this.channelUpdates.set(channel.id, {
          id: channel.id,
          updatedAt: new Date(channel.occurredAt),
          payload,
        });
      } catch {
        // ignore corrupted rows
      }
    }

    for (const batch of snapshot.batches) {
      try {
        const payload = JSON.parse(batch.payload) as RPCChannelUpdate[];
        this.channelUpdateHistory.push({
          id: batch.id,
          updatedAt: new Date(batch.occurredAt),
          payload,
        });
      } catch {
        // ignore corrupted rows
      }
    }

    for (const balance of snapshot.balances) {
      try {
        const payload = JSON.parse(balance.payload) as RPCBalance[];
        this.balanceUpdates.push({
          id: balance.id,
          updatedAt: new Date(balance.occurredAt),
          payload,
        });
      } catch {
        // ignore corrupted rows
      }
    }

    // Re-apply limits and ordering after hydration.
    this.trimMap();
    this.channelUpdateHistory.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    this.trimArray(this.channelUpdateHistory);
    this.balanceUpdates.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    this.trimArray(this.balanceUpdates);
  }

  private persistEvents(rows: ChannelEventRow[]) {
    if (!this.repository || rows.length === 0) {
      return;
    }

    try {
      this.repository.persist(rows);
    } catch (error) {
      logger.warn({ err: error }, "Failed to persist ClearNode events");
    }
  }

  public subscribe(listener: (update: ChannelEventStoreUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(update: ChannelEventStoreUpdate) {
    if (this.listeners.size === 0) {
      return;
    }

    for (const listener of Array.from(this.listeners)) {
      try {
        listener(update);
      } catch (error) {
        logger.warn({ err: error }, "ChannelEventStore listener threw an error");
      }
    }
  }
}
