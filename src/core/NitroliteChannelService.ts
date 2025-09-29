import { randomUUID } from "node:crypto";

import type { ChannelId, NitroliteClient as SdkNitroliteClient } from "@erc7824/nitrolite";

import {
  ClearNodeClient,
  type ChannelClosurePayload,
  type ClearNodeChannelBootstrap,
  type VerificationOutcomePayload,
} from "./ClearNodeClient.js";
import { NitroliteConnectionFactory } from "./NitroliteConnectionFactory.js";
import type { VerificationResult } from "./VerificationChannel.js";
import logger from "../utils/logger.js";

export interface VerificationChannelConfig {
  modelId: string;
  verifierId: string;
  metadata?: Record<string, unknown>;
}

interface ClearNodeSessionDetails {
  sessionKey?: `0x${string}`;
  depositToken?: `0x${string}`;
  depositAmount?: string;
  createTxHash?: string;
  closeTxHash?: string;
  bootstrapMetadata?: Record<string, unknown>;
  closureMetadata?: Record<string, unknown>;
}

export interface VerificationSessionMetadata extends Record<string, unknown> {
  modelId: string;
  verifierId: string;
  sdkBacked: boolean;
  clearNode?: ClearNodeSessionDetails;
}

export interface VerificationSession {
  channelId: string;
  state: "initializing" | "active" | "closing" | "closed";
  openedAt: Date;
  metadata: VerificationSessionMetadata;
}

export interface ChannelClosureContext {
  inferenceId: string;
  status: VerificationResult["status"];
  proofUrl?: string;
  reason?: string;
  completedAt?: Date;
  metadata?: Record<string, unknown>;
}

export class NitroliteChannelService {
  private sdkClient: SdkNitroliteClient | null = null;

  constructor(
    private readonly connectionFactory: NitroliteConnectionFactory,
    private readonly clearNodeClient: ClearNodeClient,
  ) {}

  public initialise(): void {
    this.getClient();
  }

  public async openVerificationChannel(
    config: VerificationChannelConfig,
  ): Promise<VerificationSession> {
    const client = this.getClient();

    const metadata: VerificationSessionMetadata = {
      ...(config.metadata ?? {}),
      modelId: config.modelId,
      verifierId: config.verifierId,
      sdkBacked: false,
    };

    const session: VerificationSession = {
      channelId: randomUUID(),
      state: "initializing",
      openedAt: new Date(),
      metadata,
    };

    try {
      const bootstrap = await this.clearNodeClient.createChannel({
        modelId: config.modelId,
        verifierId: config.verifierId,
        chainId: client.chainId,
        operator: client.account.address,
        metadata,
      });

      const { channelId, txHash } = await this.provisionChannel(client, bootstrap);

      session.channelId = channelId;
      session.state = "active";
      metadata.sdkBacked = true;
      metadata.clearNode = {
        sessionKey: bootstrap.sessionKey,
        depositToken: bootstrap.depositToken,
        depositAmount: bootstrap.depositAmount.toString(),
        createTxHash: txHash,
        bootstrapMetadata: bootstrap.metadata,
      };

      logger.info(
        { channelId, modelId: config.modelId, verifierId: config.verifierId },
        "Provisioned Nitrolite channel via ClearNode",
      );

      return session;
    } catch (error) {
      logger.warn(
        { err: error, modelId: config.modelId, verifierId: config.verifierId },
        "ClearNode-assisted channel provisioning failed; inspecting existing channels",
      );
    }

    try {
      const existingChannels = await client.getOpenChannels();
      const existing = existingChannels.at(0);

      if (existing) {
        session.channelId = existing;
        session.state = "active";
        metadata.sdkBacked = true;
        logger.debug({ channelId: existing }, "Reused existing Nitrolite channel");
        return session;
      }
    } catch (error) {
      logger.warn(
        { err: error, modelId: config.modelId, verifierId: config.verifierId },
        "Unable to discover existing Nitrolite channels; using ephemeral session",
      );
    }

    session.state = "active";
    logger.debug({ session }, "Prepared fallback verification session");
    return session;
  }

  public async closeVerificationChannel(
    session: VerificationSession,
    context?: ChannelClosureContext,
  ): Promise<void> {
    const client = this.getClient();
    session.state = "closing";

    const clearNodeMetadata = session.metadata.clearNode;

    try {
      const closurePayload: ChannelClosurePayload = {
        sessionKey: clearNodeMetadata?.sessionKey,
        metadata: this.mergeClosureMetadata(
          clearNodeMetadata?.bootstrapMetadata,
          context?.metadata,
        ),
        result: context ? this.toOutcomePayload(context) : undefined,
      };

      const closure = await this.clearNodeClient.finaliseChannel(
        session.channelId as ChannelId,
        closurePayload,
      );

      const txHash = await client.closeChannel(closure.closeParams);

      session.metadata.clearNode = {
        ...clearNodeMetadata,
        closeTxHash: txHash,
        closureMetadata: closure.metadata,
      };

      session.state = "closed";

      logger.info({ channelId: session.channelId, txHash }, "Closed Nitrolite channel");
    } catch (error) {
      session.metadata = {
        ...session.metadata,
        closeError: (error as Error).message,
      };

      await this.captureChannelDiagnostics(client, session.channelId);

      session.state = "closing";

      logger.warn({ err: error, channelId: session.channelId }, "Nitrolite channel closure failed");
      throw error;
    }
  }

  private getClient(): SdkNitroliteClient {
    if (!this.sdkClient) {
      const { client } = this.connectionFactory.create();
      this.sdkClient = client;
      logger.info("Nitrolite SDK client initialised");
    }

    return this.sdkClient;
  }

  private async provisionChannel(
    client: SdkNitroliteClient,
    bootstrap: ClearNodeChannelBootstrap,
  ): Promise<{ channelId: string; txHash?: string }> {
    const requiresDeposit = Boolean(bootstrap.depositToken) && bootstrap.depositAmount > BigInt(0);

    if (requiresDeposit && bootstrap.depositToken) {
      const { channelId, txHash } = await client.depositAndCreateChannel(
        bootstrap.depositToken,
        bootstrap.depositAmount,
        bootstrap.createParams,
      );

      logger.debug(
        { channelId, txHash, depositAmount: bootstrap.depositAmount.toString() },
        "Executed depositAndCreateChannel",
      );

      return { channelId, txHash };
    }

    const { channelId, txHash } = await client.createChannel(bootstrap.createParams);

    logger.debug({ channelId, txHash }, "Executed createChannel");

    return { channelId, txHash };
  }

  private mergeClosureMetadata(
    bootstrapMetadata?: Record<string, unknown>,
    contextMetadata?: Record<string, unknown>,
  ) {
    if (!bootstrapMetadata && !contextMetadata) {
      return undefined;
    }

    return {
      ...(bootstrapMetadata ?? {}),
      ...(contextMetadata ?? {}),
    };
  }

  private toOutcomePayload(context: ChannelClosureContext): VerificationOutcomePayload {
    return {
      inferenceId: context.inferenceId,
      status: context.status,
      proofUrl: context.proofUrl,
      reason: context.reason,
      completedAt: context.completedAt?.toISOString(),
      metadata: context.metadata,
    };
  }

  private async captureChannelDiagnostics(client: SdkNitroliteClient, channelId: string) {
    try {
      const channelData = await client.getChannelData(channelId as ChannelId);
      logger.debug({ channelId, channelData }, "Channel diagnostics snapshot");
    } catch (diagnosticError) {
      logger.warn({ err: diagnosticError, channelId }, "Failed to capture channel diagnostics");
    }
  }
}
