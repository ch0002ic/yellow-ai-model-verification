import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data", "clearnode-events.db");

export type ChannelEventRow = {
  id: string;
  type: "channel" | "channels" | "balance";
  payload: string;
  occurredAt: string;
  channelId?: string;
};

export type PersistedSnapshot = {
  channels: ChannelEventRow[];
  batches: ChannelEventRow[];
  balances: ChannelEventRow[];
};

const CREATE_EVENTS_TABLE = /* sql */ `
  CREATE TABLE IF NOT EXISTS clearnode_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    channel_id TEXT
  )
`;

const CREATE_INDEX_TYPE = /* sql */ `
  CREATE INDEX IF NOT EXISTS idx_clearnode_events_type_occurred_at
    ON clearnode_events (type, occurred_at DESC)
`;

const INSERT_EVENT = /* sql */ `
  INSERT OR REPLACE INTO clearnode_events (id, type, payload, occurred_at, channel_id)
  VALUES (@id, @type, @payload, @occurredAt, @channelId)
`;

const SELECT_LATEST = /* sql */ `
  SELECT id, type, payload, occurred_at as occurredAt, channel_id as channelId
  FROM clearnode_events
  WHERE type = @type
  ORDER BY occurred_at DESC
  LIMIT @limit
`;

const SELECT_BY_CHANNEL = /* sql */ `
  SELECT id, type, payload, occurred_at as occurredAt, channel_id as channelId
  FROM clearnode_events
  WHERE channel_id = @channelId
  ORDER BY occurred_at DESC
  LIMIT @limit
`;

const DELETE_OLDER_THAN = /* sql */ `
  DELETE FROM clearnode_events
  WHERE occurred_at < @threshold
`;

export interface ClearNodeEventRepositoryConfig {
  filePath?: string;
  maxRows?: number;
  retentionMs?: number;
}

export class ClearNodeEventRepository {
  private readonly db: Database.Database;
  private readonly maxRows: number;
  private readonly retentionMs: number;

  constructor(config: ClearNodeEventRepositoryConfig = {}) {
    const filePath = config.filePath ?? DEFAULT_DB_PATH;
    const directory = path.dirname(filePath);

    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    this.db = new Database(filePath);
    this.maxRows = config.maxRows ?? 1_000;
    this.retentionMs = config.retentionMs ?? 1000 * 60 * 60 * 24; // 24 hours

    this.db.pragma("journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(CREATE_EVENTS_TABLE);
    this.db.exec(CREATE_INDEX_TYPE);
  }

  public persist(events: ChannelEventRow[]): void {
    const insert = this.db.prepare(INSERT_EVENT);

    const transaction = this.db.transaction((rows: ChannelEventRow[]) => {
      for (const row of rows) {
        insert.run({
          ...row,
          channelId: row.channelId ?? null,
        });
      }
    });

    transaction(events);

    this.trim();
  }

  public fetchSnapshot(limit = 100): PersistedSnapshot {
    const select = this.db.prepare(SELECT_LATEST);

    const channels = select.all({ type: "channel", limit }) as ChannelEventRow[];
    const batches = select.all({ type: "channels", limit }) as ChannelEventRow[];
    const balances = select.all({ type: "balance", limit }) as ChannelEventRow[];

    return { channels, batches, balances };
  }

  public fetchChannelHistory(channelId: string, limit = 100): ChannelEventRow[] {
    const select = this.db.prepare(SELECT_BY_CHANNEL);
    return select.all({ channelId, limit }) as ChannelEventRow[];
  }

  private trim() {
    const totalRows = this.db.prepare("SELECT COUNT(*) as count FROM clearnode_events").get() as {
      count: number;
    };

    if (totalRows.count > this.maxRows) {
      const offset = totalRows.count - this.maxRows;
      const thresholdRow = this.db
        .prepare(
          "SELECT occurred_at as occurredAt FROM clearnode_events ORDER BY occurred_at DESC LIMIT 1 OFFSET @offset",
        )
        .get({ offset }) as { occurredAt?: string } | undefined;

      if (thresholdRow?.occurredAt) {
        this.db.prepare(DELETE_OLDER_THAN).run({ threshold: thresholdRow.occurredAt });
      }
    }

    if (this.retentionMs > 0) {
      const thresholdDate = new Date(Date.now() - this.retentionMs).toISOString();
      this.db.prepare(DELETE_OLDER_THAN).run({ threshold: thresholdDate });
    }
  }
}
