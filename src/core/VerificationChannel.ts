import type { VerificationSession } from "./NitroliteChannelService.js";

export interface InferencePayload {
  inferenceId: string;
  modelId: string;
  inputHash: string;
  outputHash: string;
  latencyMs: number;
  verifierSignature?: string;
  metadata?: Record<string, unknown>;
}

export interface VerificationResult {
  inferenceId: string;
  status: "pending" | "verified" | "failed";
  proofUrl?: string;
  reason?: string;
  completedAt?: Date;
  metadata?: Record<string, unknown>;
}

export class VerificationChannel {
  private readonly session: VerificationSession;
  private readonly inflight = new Map<string, InferencePayload>();
  private readonly results = new Map<string, VerificationResult>();

  constructor(session: VerificationSession) {
    this.session = session;
  }

  public getSession(): VerificationSession {
    return this.session;
  }

  public registerInference(payload: InferencePayload): void {
    if (this.inflight.has(payload.inferenceId)) {
      throw new Error(`Inference ${payload.inferenceId} already registered`);
    }

    this.inflight.set(payload.inferenceId, payload);
    this.results.set(payload.inferenceId, {
      inferenceId: payload.inferenceId,
      status: "pending",
    });
  }

  public resolveInference(inferenceId: string, result: VerificationResult): void {
    if (!this.inflight.has(inferenceId)) {
      throw new Error(`Inference ${inferenceId} is not inflight`);
    }

    this.results.set(inferenceId, {
      ...result,
      completedAt: result.completedAt ?? new Date(),
    });
    this.inflight.delete(inferenceId);
  }

  public getResult(inferenceId: string): VerificationResult | undefined {
    return this.results.get(inferenceId);
  }

  public snapshot() {
    return {
      session: this.session,
      inflight: Array.from(this.inflight.values()),
      results: Array.from(this.results.values()),
    };
  }
}
