import { Buffer } from "node:buffer";

import type {
  Channel,
  ChannelId,
  CloseChannelParams,
  CreateChannelParams,
  FinalState,
  UnsignedState,
} from "@erc7824/nitrolite";
import { StateIntent } from "@erc7824/nitrolite";

type Hex = `0x${string}`;

type Nullable<T> = T | null | undefined;

type AllocationResponse = {
  destination: Hex;
  token: Hex;
  amount: string;
};

type ChannelResponse = {
  participants: [Hex, Hex];
  adjudicator: Hex;
  challenge: string;
  nonce: string;
};

type UnsignedStateResponse = {
  intent: number | string;
  version: string;
  data: Hex;
  allocations: AllocationResponse[];
};

type CreateChannelResponse = {
  channelId: Hex;
  channel: ChannelResponse;
  unsignedState: UnsignedStateResponse;
  serverSignature: Hex;
  deposit?: {
    token?: Hex;
    amount?: string;
  };
  session?: {
    key?: Hex;
    expiresAt?: string;
  };
  metadata?: Record<string, unknown>;
};

type CloseChannelResponse = {
  channelId: Hex;
  finalState: {
    channelId: Hex;
    version: string;
    data?: Hex;
    intent?: number | string;
    allocations: AllocationResponse[];
    serverSignature: Hex;
  };
  stateData?: Hex;
  metadata?: Record<string, unknown>;
};

export interface ClearNodeClientConfig {
  baseUrl: string;
  appId: string;
  appSecret: string;
  timeoutMs?: number;
}

export interface CreateClearNodeChannelRequest {
  modelId: string;
  verifierId: string;
  chainId: number;
  operator: Hex;
  metadata?: Record<string, unknown>;
}

export interface ClearNodeChannelBootstrap {
  channelId: ChannelId;
  createParams: CreateChannelParams;
  depositToken?: Hex;
  depositAmount: bigint;
  sessionKey?: Hex;
  metadata?: Record<string, unknown>;
}

export interface VerificationOutcomePayload {
  inferenceId: string;
  status: "pending" | "verified" | "failed";
  proofUrl?: string;
  reason?: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelClosurePayload {
  result?: VerificationOutcomePayload;
  sessionKey?: Hex;
  metadata?: Record<string, unknown>;
}

export interface ClearNodeChannelClosure {
  closeParams: CloseChannelParams;
  metadata?: Record<string, unknown>;
}

export class ClearNodeClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;

  constructor(config: ClearNodeClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/?$/, "/");
    this.authHeader = `Basic ${Buffer.from(`${config.appId}:${config.appSecret}`).toString("base64")}`;
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  public async createChannel(
    payload: CreateClearNodeChannelRequest,
  ): Promise<ClearNodeChannelBootstrap> {
    const response = await this.request<CreateChannelResponse>("channels", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const createParams: CreateChannelParams = {
      channel: this.parseChannel(response.channel),
      unsignedInitialState: this.parseUnsignedState(response.unsignedState),
      serverSignature: this.parseHex(response.serverSignature, "serverSignature"),
    };

    return {
      channelId: this.parseHex(response.channelId, "channelId"),
      createParams,
      depositToken: response.deposit?.token
        ? this.parseHex(response.deposit.token, "deposit.token")
        : undefined,
      depositAmount: this.parseBigInt(response.deposit?.amount, "deposit.amount"),
      sessionKey: response.session?.key
        ? this.parseHex(response.session.key, "session.key")
        : undefined,
      metadata: response.metadata,
    };
  }

  public async finaliseChannel(
    channelId: ChannelId,
    payload: ChannelClosurePayload,
  ): Promise<ClearNodeChannelClosure> {
    const endpoint = `channels/${encodeURIComponent(channelId)}/close`;
    const response = await this.request<CloseChannelResponse>(endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const finalState: FinalState = {
      channelId: this.parseHex(response.finalState.channelId, "finalState.channelId"),
      version: this.parseBigInt(response.finalState.version, "finalState.version"),
      intent: this.parseIntent(response.finalState.intent),
      data: this.parseHex(
        response.finalState.data ?? response.stateData ?? "0x",
        "finalState.data",
      ),
      allocations: response.finalState.allocations.map((allocation, index) =>
        this.parseAllocation(allocation, `finalState.allocations[${index}]`),
      ),
      serverSignature: this.parseHex(
        response.finalState.serverSignature,
        "finalState.serverSignature",
      ),
    };

    const closeParams: CloseChannelParams = {
      stateData: this.parseHex(response.stateData ?? finalState.data, "stateData"),
      finalState,
    };

    return {
      closeParams,
      metadata: response.metadata,
    };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = new URL(path, this.baseUrl).toString();
    const headers = new Headers(init.headers);
    headers.set("Authorization", this.authHeader);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await this.safeReadError(response);
        throw new Error(`ClearNode request failed (${response.status}): ${detail}`);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`ClearNode request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseChannel(channel: Nullable<ChannelResponse>): Channel {
    if (!channel) {
      throw new Error("ClearNode response missing channel definition");
    }

    return {
      participants: [
        this.parseHex(channel.participants[0], "channel.participants[0]"),
        this.parseHex(channel.participants[1], "channel.participants[1]"),
      ],
      adjudicator: this.parseHex(channel.adjudicator, "channel.adjudicator"),
      challenge: this.parseBigInt(channel.challenge, "channel.challenge"),
      nonce: this.parseBigInt(channel.nonce, "channel.nonce"),
    };
  }

  private parseUnsignedState(state: Nullable<UnsignedStateResponse>): UnsignedState {
    if (!state) {
      throw new Error("ClearNode response missing unsigned state definition");
    }

    return {
      intent: this.parseIntent(state.intent),
      version: this.parseBigInt(state.version, "unsignedState.version"),
      data: this.parseHex(state.data, "unsignedState.data"),
      allocations: state.allocations.map((allocation, index) =>
        this.parseAllocation(allocation, `unsignedState.allocations[${index}]`),
      ),
    };
  }

  private parseAllocation(allocation: AllocationResponse, label: string) {
    return {
      destination: this.parseHex(allocation.destination, `${label}.destination`),
      token: this.parseHex(allocation.token, `${label}.token`),
      amount: this.parseBigInt(allocation.amount, `${label}.amount`),
    };
  }

  private parseIntent(intent: Nullable<number | string>): number {
    if (typeof intent === "number") {
      return intent;
    }

    if (typeof intent === "string" && intent.length > 0) {
      return Number.parseInt(intent, 10);
    }

    return StateIntent.OPERATE;
  }

  private parseBigInt(value: Nullable<string | number | bigint>, label: string): bigint {
    if (typeof value === "bigint") {
      return value;
    }

    if (typeof value === "number") {
      return BigInt(value);
    }

    if (typeof value === "string" && value.length > 0) {
      if (value.startsWith("0x")) {
        return BigInt(value);
      }

      return BigInt(value);
    }

    if (value === null || value === undefined || value === "") {
      return BigInt(0);
    }

    throw new Error(`Invalid bigint value for ${label}`);
  }

  private parseHex(value: Nullable<string>, label: string): Hex {
    if (!value || typeof value !== "string" || !value.startsWith("0x")) {
      throw new Error(`Invalid hex value for ${label}`);
    }

    return value as Hex;
  }

  private async safeReadError(response: Response): Promise<string> {
    try {
      const data: unknown = await response.json();
      if (typeof data === "object" && data !== null && "error" in data) {
        const { error: cause } = data as { error: unknown };
        return typeof cause === "string" ? cause : JSON.stringify(cause);
      }

      return JSON.stringify(data);
    } catch (error) {
      try {
        return await response.text();
      } catch {
        if (error instanceof Error) {
          return error.message;
        }

        if (typeof error === "string") {
          return error;
        }

        return "unknown error";
      }
    }
  }
}
