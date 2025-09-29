import { randomUUID } from "node:crypto";

import type {
  ChannelClosureContext,
  NitroliteChannelService,
  VerificationSession,
} from "./NitroliteChannelService.js";
import {
  VerificationChannel,
  type InferencePayload,
  type VerificationResult,
} from "./VerificationChannel.js";
import logger from "../utils/logger.js";
import {
  automatedVerifier,
  type AutomatedVerifierOutcome,
} from "../runtime/automations/automatedVerifier.js";
import type { TelemetryCollector } from "../runtime/TelemetryCollector.js";

export interface VerificationRequest {
  modelId: string;
  verifierId: string;
  inputHash: string;
  outputHash: string;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}

export interface VerificationRecord {
  id: string;
  channelSnapshot: ReturnType<VerificationChannel["snapshot"]>;
  result?: VerificationResult;
}

export class VerificationEngine {
  private readonly nitrolite: NitroliteChannelService;
  private readonly channels = new Map<string, VerificationChannel>();
  private readonly inflightAutomations = new Map<string, Promise<AutomatedVerifierOutcome>>();
  private readonly telemetry?: TelemetryCollector;

  constructor(nitrolite: NitroliteChannelService, telemetry?: TelemetryCollector) {
    this.nitrolite = nitrolite;
    this.telemetry = telemetry;
  }

  public async startVerification(request: VerificationRequest): Promise<VerificationRecord> {
    const session = await this.createSession(request);
    const channel = new VerificationChannel(session);

    const inference: InferencePayload = {
      inferenceId: randomUUID(),
      modelId: request.modelId,
      inputHash: request.inputHash,
      outputHash: request.outputHash,
      latencyMs: request.latencyMs,
      metadata: request.metadata,
    };

    channel.registerInference(inference);
    this.channels.set(inference.inferenceId, channel);

    const record = {
      id: inference.inferenceId,
      channelSnapshot: channel.snapshot(),
    };

    this.telemetry?.recordVerificationStarted(record);
    this.scheduleAutomation(record).catch((error) => {
      logger.warn({ err: error, inferenceId: record.id }, "Verification automation failed");
    });

    return record;
  }

  public async resolveVerification(
    inferenceId: string,
    result: VerificationResult,
  ): Promise<VerificationRecord> {
    const channel = this.channels.get(inferenceId);
    if (!channel) {
      throw new Error(`No active verification for inference ${inferenceId}`);
    }

    channel.resolveInference(inferenceId, result);

    const session = channel.getSession();

    if (session.state !== "closed") {
      try {
        await this.nitrolite.closeVerificationChannel(
          session,
          this.buildClosureContext(inferenceId, result),
        );
      } catch (error) {
        logger.warn(
          { err: error, inferenceId, channelId: session.channelId },
          "Nitrolite channel closure attempt failed",
        );
      }
    }

    const resolvedRecord = {
      id: inferenceId,
      channelSnapshot: channel.snapshot(),
      result,
    };

    this.telemetry?.recordVerificationResolved(resolvedRecord);
    return resolvedRecord;
  }

  public getVerification(inferenceId: string): VerificationRecord | undefined {
    const channel = this.channels.get(inferenceId);
    if (!channel) {
      return undefined;
    }

    const result = channel.getResult(inferenceId);
    return {
      id: inferenceId,
      channelSnapshot: channel.snapshot(),
      result,
    };
  }

  public listVerifications(): VerificationRecord[] {
    return Array.from(this.channels.entries()).map(([inferenceId, channel]) => {
      const result = channel.getResult(inferenceId);
      return {
        id: inferenceId,
        channelSnapshot: channel.snapshot(),
        result,
      };
    });
  }

  private async createSession(request: VerificationRequest): Promise<VerificationSession> {
    return this.nitrolite.openVerificationChannel({
      modelId: request.modelId,
      verifierId: request.verifierId,
      metadata: request.metadata,
    });
  }

  private async scheduleAutomation(record: VerificationRecord): Promise<AutomatedVerifierOutcome | void> {
    if (this.inflightAutomations.has(record.id)) {
      return this.inflightAutomations.get(record.id);
    }

    this.telemetry?.recordAutomationScheduled();

    const task = automatedVerifier
      .run(record, {
        resolve: async (result: VerificationResult) => {
          await this.resolveVerification(record.id, result);
        },
      })
      .then((outcome: AutomatedVerifierOutcome) => {
        this.telemetry?.recordAutomationOutcome(outcome);
        return outcome;
      })
      .catch((error: unknown) => {
        const outcome: AutomatedVerifierOutcome = { status: "failed", error };
        this.telemetry?.recordAutomationOutcome(outcome);
        throw error;
      })
      .finally(() => {
        this.inflightAutomations.delete(record.id);
      });

    this.inflightAutomations.set(record.id, task);
    return task;
  }

  private buildClosureContext(
    inferenceId: string,
    result: VerificationResult,
  ): ChannelClosureContext {
    const completedAt = result.completedAt ?? new Date();
    const metadata: Record<string, unknown> = {
      ...(result.metadata ?? {}),
    };

    if (result.proofUrl) {
      metadata.proofUrl = result.proofUrl;
    }

    if (result.reason) {
      metadata.reason = result.reason;
    }

    return {
      inferenceId,
      status: result.status,
      proofUrl: result.proofUrl,
      reason: result.reason,
      completedAt,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }
}
