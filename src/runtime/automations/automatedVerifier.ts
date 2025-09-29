import { setTimeout as delay } from "node:timers/promises";

import type { VerificationRecord } from "../../core/VerificationEngine.js";
import type { VerificationResult } from "../../core/VerificationChannel.js";
import logger from "../../utils/logger.js";

const DEFAULT_MIN_LATENCY_MS = 400;
const DEFAULT_MAX_LATENCY_MS = 1800;

export interface AutomatedVerifierOptions {
  resolve: (result: VerificationResult) => Promise<void> | void;
  mintProofUrl?: (record: VerificationRecord) => Promise<string | undefined> | string | undefined;
  evaluate?: (record: VerificationRecord) => Promise<VerificationResult["status"]> | VerificationResult["status"];
}

export type AutomatedVerifierOutcome =
  | { status: "skipped" }
  | { status: "completed"; result: VerificationResult }
  | { status: "failed"; error: unknown };

export const automatedVerifier = {
  async run(record: VerificationRecord, options: AutomatedVerifierOptions): Promise<AutomatedVerifierOutcome> {
    const { resolve } = options;

    if (!resolve) {
      logger.debug({ inferenceId: record.id }, "Automated verifier skipped: no resolve handler");
      return { status: "skipped" };
    }

    const start = Date.now();
    const createdAt = new Date(start).toISOString();

    try {
      await delay(getRandomLatency(DEFAULT_MIN_LATENCY_MS, DEFAULT_MAX_LATENCY_MS));

      const status = (await options.evaluate?.(record)) ?? "verified";
      let proofUrl: string | undefined;

      try {
        proofUrl = await options.mintProofUrl?.(record);
      } catch (error) {
        logger.warn({ err: error, inferenceId: record.id }, "Automated verifier failed to mint proof URL");
      }

      const result: VerificationResult = {
        inferenceId: record.id,
        status,
        proofUrl,
        completedAt: new Date(),
        metadata: {
          ...record.channelSnapshot.session.metadata,
          automated: true,
          evaluatedBy: "automatedVerifier",
          processingMs: Date.now() - start,
          createdAt,
        },
      };

      if (status === "failed" && !result.reason) {
        result.reason = "Automated policies flagged this inference";
      }

      await resolve(result);
      return { status: "completed", result };
    } catch (error) {
      logger.warn({ err: error, inferenceId: record.id }, "Automated verifier encountered an error");
      return { status: "failed", error };
    }
  },
};

function getRandomLatency(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
