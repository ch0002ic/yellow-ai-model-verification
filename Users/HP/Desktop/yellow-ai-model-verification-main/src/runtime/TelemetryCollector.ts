import type {
  ChannelEventStoreUpdate,
  ChannelEventsSnapshot,
} from "./ChannelEventStore.js";
import type { VerificationRecord } from "../core/VerificationEngine.js";
import type { VerificationResult } from "../core/VerificationChannel.js";
import type { AutomatedVerifierOutcome } from "./automations/automatedVerifier.js";

type ChannelEventType = ChannelEventStoreUpdate["type"];

type ChannelEventMetrics = {
  total: number;
  byType: Record<ChannelEventType, number>;
  lastEventAt?: string;
};

type VerificationMetrics = {
  totalStarted: number;
  active: number;
  resolved: number;
  resolvedByStatus: Record<VerificationResult["status"], number>;
  lastStartedAt?: string;
  lastResolvedAt?: string;
};

type AutomationMetrics = {
  triggered: number;
  pending: number;
  completed: number;
  failed: number;
  skipped: number;
  processingSumMs: number;
  processingCount: number;
  lastCompletedAt?: string;
};

export type TelemetrySnapshot = {
  bootedAt: string;
  generatedAt: string;
  channelEvents: ChannelEventMetrics & { snapshotSize: number };
  verifications: VerificationMetrics;
  automation: AutomationMetrics & { averageProcessingMs: number | null };
};

const initialiseChannelEventMetrics = (): ChannelEventMetrics => ({
  total: 0,
  byType: {
    channel: 0,
    channels: 0,
    balance: 0,
  },
});

const initialiseVerificationMetrics = (): VerificationMetrics => ({
  totalStarted: 0,
  active: 0,
  resolved: 0,
  resolvedByStatus: {
    pending: 0,
    verified: 0,
    failed: 0,
  },
});

const initialiseAutomationMetrics = (): AutomationMetrics => ({
  triggered: 0,
  pending: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  processingSumMs: 0,
  processingCount: 0,
});

export class TelemetryCollector {
  private readonly bootedAt = new Date();
  private readonly channelMetrics: ChannelEventMetrics = initialiseChannelEventMetrics();
  private readonly verificationMetrics: VerificationMetrics = initialiseVerificationMetrics();
  private readonly automationMetrics: AutomationMetrics = initialiseAutomationMetrics();
  private channelSnapshotSize = 0;

  public ingestSnapshot(snapshot: ChannelEventsSnapshot): void {
    const channelCount = snapshot.channels.length;
    const batchCount = snapshot.batches.length;
    const balanceCount = snapshot.balances.length;

  this.channelMetrics.total = channelCount + batchCount + balanceCount;
  this.channelMetrics.byType.channel = channelCount;
  this.channelMetrics.byType.channels = batchCount;
  this.channelMetrics.byType.balance = balanceCount;

    const latestTimestamp = this.findLatestTimestamp(snapshot);
    if (latestTimestamp) {
      this.channelMetrics.lastEventAt = latestTimestamp;
    }

    this.channelSnapshotSize = channelCount;
  }

  public recordChannelEvent(update: ChannelEventStoreUpdate): void {
    this.channelMetrics.total += 1;
    this.channelMetrics.byType[update.type] += 1;
    this.channelMetrics.lastEventAt = update.occurredAt;
    this.channelSnapshotSize = update.snapshot.channels.length;
  }

  public recordVerificationStarted(record: VerificationRecord): void {
    this.verificationMetrics.totalStarted += 1;
    this.verificationMetrics.active += 1;
    this.verificationMetrics.lastStartedAt = new Date().toISOString();
  }

  public recordVerificationResolved(record: VerificationRecord): void {
    if (this.verificationMetrics.active > 0) {
      this.verificationMetrics.active -= 1;
    }

    this.verificationMetrics.resolved += 1;
    this.verificationMetrics.lastResolvedAt = toIsoString(record.result?.completedAt) ?? new Date().toISOString();

    if (record.result) {
      this.verificationMetrics.resolvedByStatus[record.result.status] += 1;
    }

    if (record.result?.metadata?.automated) {
      this.recordAutomationCompleted(record.result);
    }
  }

  public recordAutomationScheduled(): void {
    this.automationMetrics.triggered += 1;
    this.automationMetrics.pending += 1;
  }

  public recordAutomationOutcome(outcome: AutomatedVerifierOutcome): void {
    if (this.automationMetrics.pending > 0) {
      this.automationMetrics.pending -= 1;
    }

    switch (outcome.status) {
      case "completed":
        this.automationMetrics.completed += 1;
        this.recordAutomationCompleted(outcome.result);
        break;
      case "failed":
        this.automationMetrics.failed += 1;
        break;
      case "skipped":
        this.automationMetrics.skipped += 1;
        break;
    }
  }

  public snapshot(): TelemetrySnapshot {
    const generatedAt = new Date();
    const averageProcessingMs =
      this.automationMetrics.processingCount > 0
        ? Math.round(this.automationMetrics.processingSumMs / this.automationMetrics.processingCount)
        : null;

    return {
      bootedAt: this.bootedAt.toISOString(),
      generatedAt: generatedAt.toISOString(),
      channelEvents: {
        ...this.channelMetrics,
        snapshotSize: this.channelSnapshotSize,
      },
      verifications: { ...this.verificationMetrics },
      automation: {
        ...this.automationMetrics,
        averageProcessingMs,
      },
    };
  }

  private recordAutomationCompleted(result: VerificationResult): void {
  this.automationMetrics.lastCompletedAt = toIsoString(result.completedAt) ?? new Date().toISOString();

    const processingTime = this.extractProcessingTime(result);
    if (processingTime !== null) {
      this.automationMetrics.processingSumMs += processingTime;
      this.automationMetrics.processingCount += 1;
    }
  }

  private extractProcessingTime(result: VerificationResult): number | null {
    const processingMs = result.metadata?.processingMs;

    if (typeof processingMs === "number" && Number.isFinite(processingMs)) {
      return processingMs;
    }

    if (result.metadata?.createdAt) {
      const started = parseDateInput(result.metadata.createdAt);
      const completed = parseDateInput(result.completedAt);

      if (started !== null && completed !== null) {
        return Math.max(0, completed - started);
      }
    }

    return null;
  }

  private findLatestTimestamp(snapshot: ChannelEventsSnapshot): string | undefined {
    const timestamps = [
      ...snapshot.channels.map((entry) => entry.updatedAt.toISOString()),
      ...snapshot.batches.map((entry) => entry.updatedAt.toISOString()),
      ...snapshot.balances.map((entry) => entry.updatedAt.toISOString()),
    ];

    if (timestamps.length === 0) {
      return undefined;
    }

    return timestamps.sort().at(-1);
  }
}

const toIsoString = (value: unknown): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return undefined;
};

const parseDateInput = (value: unknown): number | null => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    const timestamp = date.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  return null;
};