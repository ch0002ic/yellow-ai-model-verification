import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Express, type Request, type Response } from "express";

import env from "../config/environment.js";
import type {
  VerificationEngine,
  VerificationRecord,
  VerificationRequest,
} from "../core/VerificationEngine.js";
import type { VerificationResult } from "../core/VerificationChannel.js";
import type {
  ChannelEventStore,
  ChannelEventStoreUpdate,
} from "../runtime/ChannelEventStore.js";
import type {
  ChannelEventRow,
  ClearNodeEventRepository,
} from "../persistence/ClearNodeEventRepository.js";
import type { TelemetryCollector } from "../runtime/TelemetryCollector.js";
import logger from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_ASSETS_DIR = resolve(__dirname, "../../public");
const STATIC_INDEX_PATH = resolve(STATIC_ASSETS_DIR, "index.html");

export type VerificationResolutionPayload = {
  status: "verified" | "failed";
  proofUrl?: string;
  reason?: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
};

export class ApiServer {
  private readonly app: Express;
  private readonly verificationEngine: VerificationEngine;
  private readonly channelEventStore?: ChannelEventStore;
  private readonly channelEventRepository?: ClearNodeEventRepository;
  private readonly telemetryCollector?: TelemetryCollector;
  private readonly staticAssetsDir?: string;
  private readonly staticIndexPath?: string;
  private server?: ReturnType<Express["listen"]>;

  constructor(
    verificationEngine: VerificationEngine,
    channelEventStore?: ChannelEventStore,
    channelEventRepository?: ClearNodeEventRepository,
    telemetryCollector?: TelemetryCollector,
  ) {
    this.verificationEngine = verificationEngine;
    this.channelEventStore = channelEventStore;
    this.channelEventRepository = channelEventRepository;
    this.telemetryCollector = telemetryCollector;
    this.app = express();

    this.staticAssetsDir = STATIC_ASSETS_DIR;
    this.staticIndexPath = STATIC_INDEX_PATH;

    this.configureMiddleware();
    this.configureRoutes();
  }

  private configureMiddleware(): void {
    this.app.use(express.json());

    if (this.staticAssetsDir) {
      this.app.use(express.static(this.staticAssetsDir));
    }
  }

  private configureRoutes(): void {
    this.app.get("/api/verifications", this.handleListVerifications);
    this.app.post("/api/verifications", this.handleCreateVerification);
    this.app.get("/api/verifications/:id", this.handleGetVerification);
    this.app.post("/api/verifications/:id/resolve", this.handleResolveVerification);

    if (this.channelEventStore) {
      this.app.get("/api/clearnode/events", this.handleGetClearNodeEvents);
      this.app.get("/api/clearnode/events/stream", this.handleStreamClearNodeEvents);
    }

    if (this.channelEventRepository) {
      this.app.get(
        "/api/clearnode/channels/:channelId",
        this.handleGetClearNodeChannelHistory,
      );
    }

    if (this.telemetryCollector) {
      this.app.get("/api/metrics", this.handleGetMetrics);
      this.app.get("/api/health", this.handleHealthCheck);
    }

    if (this.staticIndexPath) {
      this.app.get(["/", "/dashboard"], this.handleServeIndex);
    }
  }

  public async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server = this.app.listen(env.port, () => {
        logger.info({ port: env.port }, "API server listening");
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private handleCreateVerification = async (req: Request, res: Response) => {
    try {
      const payload = req.body as VerificationRequest;
      const record = await this.verificationEngine.startVerification(payload);
      res.status(201).json(record);
    } catch (error) {
      logger.error({ error }, "Failed to create verification");
      res.status(400).json({ error: (error as Error).message });
    }
  };

  private handleListVerifications = (_req: Request, res: Response) => {
    const records = this.verificationEngine.listVerifications();
    res.json(records);
  };

  private handleGetVerification = (req: Request, res: Response) => {
    const { id } = req.params;
    const record: VerificationRecord | undefined = this.verificationEngine.getVerification(id);

    if (!record) {
      res.status(404).json({ error: "Verification not found" });
      return;
    }

    res.json(record);
  };

  private handleResolveVerification = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const payload = req.body as VerificationResolutionPayload;

      if (!payload?.status || !["verified", "failed"].includes(payload.status)) {
        res.status(400).json({ error: "status must be 'verified' or 'failed'" });
        return;
      }

      if (payload.status === "failed" && !payload.reason) {
        res.status(400).json({ error: "reason is required when status is 'failed'" });
        return;
      }

      const completedAt = this.parseCompletedAt(payload.completedAt);

      const result: VerificationResult = {
        inferenceId: id,
        status: payload.status,
        proofUrl: payload.proofUrl,
        reason: payload.reason,
        completedAt,
        metadata: payload.metadata,
      };

      const record = await this.verificationEngine.resolveVerification(id, result);
      res.json(record);
    } catch (error) {
      logger.error({ error }, "Failed to resolve verification");
      res.status(400).json({ error: (error as Error).message });
    }
  };

  private handleGetClearNodeEvents = (_req: Request, res: Response) => {
    if (!this.channelEventStore) {
      res.status(503).json({ error: "ClearNode event store is not configured" });
      return;
    }

    res.json(this.channelEventStore.snapshot());
  };

  private handleStreamClearNodeEvents = (req: Request, res: Response) => {
    if (!this.channelEventStore) {
      res.status(503).json({ error: "ClearNode event store is not configured" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const sendUpdate = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const initialPayload: Record<string, unknown> = {
      type: "snapshot",
      occurredAt: new Date().toISOString(),
      snapshot: this.channelEventStore.snapshot(),
    };

    if (this.telemetryCollector) {
      initialPayload.metrics = this.telemetryCollector.snapshot();
    }

    sendUpdate(initialPayload);

    const unsubscribe = this.channelEventStore.subscribe((update) => {
      const payload: Record<string, unknown> = { ...augmentUpdate(update) };
      if (this.telemetryCollector) {
        payload.metrics = this.telemetryCollector.snapshot();
      }
      sendUpdate(payload);
    });

    const heartbeat = setInterval(() => {
      if (!res.writable || res.writableEnded) {
        return;
      }

      if (this.telemetryCollector) {
        sendUpdate({
          type: "heartbeat",
          occurredAt: new Date().toISOString(),
          metrics: this.telemetryCollector.snapshot(),
        });
      } else {
        res.write(":keep-alive\n\n");
      }
    }, 15000);
    heartbeat.unref?.();

    const cleanup = () => {
      unsubscribe();
      clearInterval(heartbeat);
      if (!res.writableEnded) {
        res.end();
      }
    };

    req.once("close", cleanup);
    req.once("end", cleanup);
  };

  private handleGetClearNodeChannelHistory = (req: Request, res: Response) => {
    if (!this.channelEventRepository) {
      res.status(503).json({ error: "ClearNode event repository is not configured" });
      return;
    }

    const { channelId } = req.params;

    if (!channelId || channelId.trim().length === 0) {
      res.status(400).json({ error: "channelId is required" });
      return;
    }

    const rows = this.channelEventRepository.fetchChannelHistory(channelId, 200);
    res.json(rows.map(parsePersistedRow));
  };

  private handleGetMetrics = (_req: Request, res: Response) => {
    if (!this.telemetryCollector) {
      res.status(503).json({ error: "Telemetry is not configured" });
      return;
    }

    res.json(this.telemetryCollector.snapshot());
  };

  private handleHealthCheck = (_req: Request, res: Response) => {
    if (!this.telemetryCollector) {
      res.status(503).json({ status: "degraded", reason: "telemetry_not_configured" });
      return;
    }

    const snapshot = this.telemetryCollector.snapshot();
    res.json({ status: "ok", generatedAt: snapshot.generatedAt, metrics: snapshot });
  };

  private handleServeIndex = (_req: Request, res: Response) => {
    if (!this.staticIndexPath) {
      res.status(404).end();
      return;
    }

    res.sendFile(this.staticIndexPath, (error) => {
      if (error) {
        logger.warn({ err: error, path: this.staticIndexPath }, "Failed to serve dashboard index");
        if (!res.headersSent) {
          res.status((error as { statusCode?: number }).statusCode ?? 500).end();
        }
      }
    });
  };

  private parseCompletedAt(isoString?: string): Date | undefined {
    if (!isoString) {
      return undefined;
    }

    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      throw new Error("completedAt must be a valid ISO-8601 datetime string");
    }

    return date;
  }
}

const parsePersistedRow = (row: ChannelEventRow) => {
  const base = {
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt,
    channelId: row.channelId,
  } as const;

  try {
    return {
      ...base,
      payload: JSON.parse(row.payload),
    };
  } catch {
    return {
      ...base,
      payload: row.payload,
    };
  }
};

const augmentUpdate = (update: ChannelEventStoreUpdate) => ({
  ...update,
  receivedAt: new Date().toISOString(),
});
