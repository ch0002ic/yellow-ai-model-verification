import WebSocket from "ws";

import {
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
} from "@erc7824/nitrolite/dist/rpc/api.js";
import {
  EIP712AuthTypes,
  RPCMethod,
  type MessageSigner,
  type NitroliteRPCMessage,
  type RPCAllowance,
  type RPCBalance,
  type RPCChannelUpdate,
  type RPCData,
} from "@erc7824/nitrolite/dist/rpc/types/index.js";
import type { PrivateKeyAccount } from "viem/accounts";

import logger from "../utils/logger.js";

const DEFAULT_RECONNECT_DELAY_MS = 5_000;
const DEFAULT_AUTH_SCOPE = "nitrolite-channel";
const DEFAULT_AUTH_EXPIRY_SECONDS = 300;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

interface AuthContext {
  expire: string;
  scope: string;
  application: `0x${string}`;
  participant: `0x${string}`;
  sessionKey: `0x${string}`;
  allowances: RPCAllowance[];
}

export type ClearNodeWebSocketEventMap = {
  authenticated: { sessionKey?: string; jwtToken?: string };
  authenticationFailed: { params: unknown };
  channelsUpdate: RPCChannelUpdate[];
  channelUpdate: RPCChannelUpdate;
  balanceUpdate: RPCBalance[];
  message: NitroliteRPCMessage;
  error: unknown;
};

export interface ClearNodeWebSocketConfig {
  url: string;
  appName: string;
  operatorAccount: PrivateKeyAccount;
  reconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
  scope?: string;
  applicationAddress?: `0x${string}`;
  sessionKey?: `0x${string}`;
  allowances?: RPCAllowance[];
  authExpirySeconds?: number;
}

export class ClearNodeWebSocketClient {
  private readonly reconnectDelayMs: number;
  private readonly heartbeatIntervalMs: number;
  private websocket: WebSocket | null = null;
  private shouldReconnect = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private authContext: AuthContext | null = null;
  private messageSigner: MessageSigner | null = null;
  private isAuthenticated = false;
  private readonly listeners = new Map<
    keyof ClearNodeWebSocketEventMap,
    Set<(payload: unknown) => void>
  >();

  constructor(private readonly config: ClearNodeWebSocketConfig) {
    this.reconnectDelayMs = config.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  public on<K extends keyof ClearNodeWebSocketEventMap>(
    event: K,
    listener: (payload: ClearNodeWebSocketEventMap[K]) => void,
  ): () => void {
    const existing = this.listeners.get(event) ?? new Set<(payload: unknown) => void>();
    existing.add(listener as (payload: unknown) => void);
    this.listeners.set(event, existing);
    return () => this.off(event, listener);
  }

  public once<K extends keyof ClearNodeWebSocketEventMap>(
    event: K,
    listener: (payload: ClearNodeWebSocketEventMap[K]) => void,
  ): () => void {
    const wrapped = (payload: ClearNodeWebSocketEventMap[K]) => {
      this.off(event, wrapped);
      listener(payload);
    };

    return this.on(event, wrapped);
  }

  public off<K extends keyof ClearNodeWebSocketEventMap>(
    event: K,
    listener: (payload: ClearNodeWebSocketEventMap[K]) => void,
  ): void {
    const registered = this.listeners.get(event);

    if (!registered) {
      return;
    }

    registered.delete(listener as (payload: unknown) => void);

    if (registered.size === 0) {
      this.listeners.delete(event);
    }
  }

  private emit<K extends keyof ClearNodeWebSocketEventMap>(
    event: K,
    payload: ClearNodeWebSocketEventMap[K],
  ): void {
    const registered = this.listeners.get(event);

    if (!registered || registered.size === 0) {
      return;
    }

    for (const listener of Array.from(registered)) {
      try {
        (listener as (payload: ClearNodeWebSocketEventMap[K]) => void)(payload);
      } catch (error) {
        logger.error({ error, event }, "ClearNode WebSocket listener execution failed");
      }
    }
  }

  public async connect(): Promise<void> {
    if (this.websocket) {
      return;
    }

    this.shouldReconnect = true;
    await this.openSocket();
  }

  public get authenticated(): boolean {
    return this.isAuthenticated;
  }

  public async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();

    if (!this.websocket) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.websocket?.once("close", () => resolve());
      this.websocket?.close();
    });

    this.websocket = null;
    this.resetAuthState();
  }

  private async openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.url);
      let settled = false;

      const resolveOnce = () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();
      };

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(error);
      };

      const handleOpen = async () => {
        this.websocket = ws;
        logger.info({ url: this.config.url }, "Connected to ClearNode WebSocket");
        this.startHeartbeat();

        try {
          await this.sendAuthRequest();
          resolveOnce();
        } catch (error) {
          const serialisedError = error instanceof Error ? error : new Error(String(error));
          logger.error({ err: serialisedError }, "Failed to initiate ClearNode auth handshake");
          rejectOnce(serialisedError);
          ws.close();
        }
      };

      const handleMessage = (data: WebSocket.RawData) => {
        void this.onSocketMessage(data);
      };

      const handlePing = (data: Buffer) => {
        if (ws.readyState !== WebSocket.OPEN) {
          return;
        }

        try {
          ws.pong(data, true, (error) => {
            if (error) {
              logger.warn({ err: error }, "Failed to respond to ClearNode WebSocket ping");
            }
          });
          logger.debug("Responded to ClearNode WebSocket ping");
        } catch (error) {
          logger.warn({ err: error }, "Error handling ClearNode WebSocket ping");
        }
      };

      const handlePong = () => {
        logger.debug("Received ClearNode WebSocket pong");
      };

      const handleError = (error: Error) => {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes("Unexpected server response")) {
          logger.error(
            {
              err: error,
              url: this.config.url,
              guidance:
                "Verify that NITROLITE_CLEAR_NODE_WS_URL points to a WebSocket-capable gateway (e.g. wss://clearnet-sandbox.yellow.com/ws).",
            },
            "ClearNode WebSocket handshake failed",
          );
        } else {
          logger.error({ err: error }, "ClearNode WebSocket encountered an error");
        }

        this.stopHeartbeat();
        rejectOnce(error);
      };

      const handleClose = (code: number, reason: Buffer) => {
        logger.warn({ code, reason: reason.toString() }, "ClearNode WebSocket connection closed");

        ws.off("message", handleMessage);
        ws.off("error", handleError);
        ws.off("ping", handlePing);
        ws.off("pong", handlePong);

        this.websocket = null;
        this.stopHeartbeat();
        this.resetAuthState();

        if (!settled) {
          rejectOnce(new Error(`ClearNode WebSocket closed before becoming ready (code ${code})`));
        }

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      ws.once("open", handleOpen);
      ws.on("message", handleMessage);
      ws.on("error", handleError);
      ws.once("close", handleClose);
      ws.on("ping", handlePing);
      ws.on("pong", handlePong);
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket().catch((error: unknown) => {
        logger.error({ err: error }, "Failed to reconnect ClearNode WebSocket");
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });
    }, this.reconnectDelayMs);

    logger.info({ delayMs: this.reconnectDelayMs }, "Scheduled ClearNode WebSocket reconnect");
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startHeartbeat() {
    if (this.heartbeatTimer || this.heartbeatIntervalMs <= 0) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        this.websocket.ping();
        logger.debug("Sent ClearNode WebSocket heartbeat ping");
      } catch (error) {
        logger.warn({ err: error }, "Failed to send ClearNode WebSocket heartbeat ping");
      }
    }, this.heartbeatIntervalMs).unref();
  }

  private stopHeartbeat() {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async onSocketMessage(data: WebSocket.RawData): Promise<void> {
    const frameText = this.decodeFrame(data);
    let payload: unknown = frameText;

    try {
      payload = JSON.parse(frameText);
    } catch {
      // Non-JSON frames (pongs, heartbeats, etc.) fall back to raw text.
    }

    logger.debug({ payload }, "Received ClearNode WebSocket frame");

    if (this.isNitroliteMessage(payload)) {
      await this.handleNitroliteMessage(payload);
    }
  }

  private isNitroliteMessage(payload: unknown): payload is NitroliteRPCMessage {
    if (!payload || typeof payload !== "object") {
      return false;
    }

    return "req" in payload || "res" in payload;
  }

  private async handleNitroliteMessage(message: NitroliteRPCMessage): Promise<void> {
    this.emit("message", message);

    if (message.res) {
      await this.dispatchRpcPayload(message.res, "res");
    }

    if (message.req) {
      await this.dispatchRpcPayload(message.req, "req");
    }
  }

  private async dispatchRpcPayload(payload: RPCData, source: "req" | "res"): Promise<void> {
    const [requestId, method, params] = payload;

    switch (method) {
      case RPCMethod.AuthRequest:
      case RPCMethod.AuthChallenge:
        await this.handleAuthChallenge(params);
        break;
      case RPCMethod.AuthVerify:
        if (source === "res") {
          this.handleAuthVerify(params);
        } else {
          logger.debug(
            { requestId, params },
            "Received auth_verify request payload from ClearNode",
          );
        }
        break;
      case RPCMethod.ChannelsUpdate:
        this.handleChannelsUpdate(params);
        break;
      case RPCMethod.ChannelUpdate:
        this.handleChannelUpdate(params);
        break;
      case RPCMethod.BalanceUpdate:
        this.handleBalanceUpdate(params);
        break;
      case RPCMethod.Error:
        this.handleErrorResponse(params);
        break;
      default:
        logger.debug({ method, params, source, requestId }, "Unhandled ClearNode RPC payload");
    }
  }

  private async handleAuthChallenge(params: unknown): Promise<void> {
    const challenge = this.extractChallenge(params);

    if (!challenge) {
      logger.warn({ params }, "Received ClearNode auth challenge without a challenge string");
      return;
    }

    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      logger.warn("Skipping auth_verify submission because WebSocket is not open");
      return;
    }

    try {
      const signer = this.ensureMessageSigner();
      const verifyMessage = await createAuthVerifyMessageFromChallenge(signer, challenge);
      this.websocket.send(verifyMessage);
      logger.info("Submitted ClearNode auth_verify response");
    } catch (error) {
      logger.error({ err: error }, "Failed to submit auth_verify response to ClearNode");
      this.emit("error", error);
    }
  }

  private handleAuthVerify(params: unknown): void {
    if (!params || typeof params !== "object") {
      logger.warn({ params }, "Received malformed auth_verify response");
      return;
    }

    const typedParams = params as { success?: boolean; sessionKey?: string; jwtToken?: string };
    const success = Boolean(typedParams.success);
    this.isAuthenticated = success;

    if (success) {
      logger.info(
        {
          sessionKey: typedParams.sessionKey,
          jwtPresent: Boolean(typedParams.jwtToken),
        },
        "ClearNode WebSocket authentication completed",
      );
      this.emit("authenticated", {
        sessionKey: typedParams.sessionKey,
        jwtToken: typedParams.jwtToken,
      });
    } else {
      logger.warn({ params }, "ClearNode auth_verify reported failure");
      this.emit("authenticationFailed", { params });
    }
  }

  private handleErrorResponse(params: unknown): void {
    if (params && typeof params === "object" && "error" in params) {
      logger.error({ error: (params as { error: unknown }).error }, "ClearNode RPC error response");
      this.emit("error", params);
      return;
    }

    logger.error({ params }, "ClearNode RPC returned an error payload without details");
    this.emit("error", params);
  }

  private extractChallenge(params: unknown): string | null {
    if (!params || typeof params !== "object") {
      return null;
    }

    if (
      "challengeMessage" in params &&
      typeof (params as { challengeMessage: unknown }).challengeMessage === "string"
    ) {
      return (params as { challengeMessage: string }).challengeMessage;
    }

    if (
      "challenge_message" in params &&
      typeof (params as { challenge_message: unknown }).challenge_message === "string"
    ) {
      return (params as { challenge_message: string }).challenge_message;
    }

    if ("challenge" in params && typeof (params as { challenge: unknown }).challenge === "string") {
      return (params as { challenge: string }).challenge;
    }

    return null;
  }

  private handleChannelsUpdate(params: unknown): void {
    if (!params || typeof params !== "object") {
      logger.warn({ params }, "Channels update payload missing params");
      return;
    }

    const channels = (params as { channels?: unknown }).channels;

    if (!Array.isArray(channels)) {
      logger.warn({ params }, "Channels update payload missing channels array");
      return;
    }

    this.emit("channelsUpdate", channels as RPCChannelUpdate[]);
  }

  private handleChannelUpdate(params: unknown): void {
    if (!params || typeof params !== "object") {
      logger.warn({ params }, "Channel update payload missing params");
      return;
    }

    this.emit("channelUpdate", params as RPCChannelUpdate);
  }

  private handleBalanceUpdate(params: unknown): void {
    if (!params || typeof params !== "object") {
      logger.warn({ params }, "Balance update payload missing params");
      return;
    }

    const typed = params as { balanceUpdates?: unknown; balance_updates?: unknown };
    const balances = typed.balanceUpdates ?? typed.balance_updates;

    if (!Array.isArray(balances)) {
      logger.warn({ params }, "Balance update payload missing balanceUpdates array");
      return;
    }

    this.emit("balanceUpdate", balances as RPCBalance[]);
  }

  private async sendAuthRequest(): Promise<void> {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error("Cannot send auth_request because WebSocket is not open");
    }

    const context = this.buildAuthContext();
    const params: Parameters<typeof createAuthRequestMessage>[0] = {
      address: context.participant,
      session_key: context.sessionKey,
      app_name: this.config.appName,
      allowances: context.allowances,
      expire: context.expire,
      scope: context.scope,
      application: context.application,
    };

    const authMessage = await createAuthRequestMessage(params);
    this.websocket.send(authMessage);

    this.authContext = context;
    this.messageSigner = null;
    this.isAuthenticated = false;

    logger.debug(
      { params, domain: this.getAuthDomain() },
      "Dispatched ClearNode auth_request message",
    );
  }

  private buildAuthContext(): AuthContext {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expirySeconds = this.config.authExpirySeconds ?? DEFAULT_AUTH_EXPIRY_SECONDS;

    const participant = this.operatorAddress;
    const sessionKey = this.config.sessionKey ?? participant;
    const application = this.config.applicationAddress ?? participant;
    const scope = this.config.scope ?? DEFAULT_AUTH_SCOPE;

    const allowances = (this.config.allowances ?? []).map((allowance) => ({
      asset: allowance.asset,
      amount: allowance.amount,
    }));

    return {
      expire: String(nowSeconds + expirySeconds),
      scope,
      application,
      participant,
      sessionKey,
      allowances,
    };
  }

  private ensureMessageSigner(): MessageSigner {
    if (!this.authContext) {
      throw new Error(
        "Auth context is not initialised; auth_request must complete before auth_verify",
      );
    }

    if (!this.messageSigner) {
      this.messageSigner = this.createMessageSigner(this.authContext);
    }

    return this.messageSigner;
  }

  private createMessageSigner(context: AuthContext): MessageSigner {
    return async (payload) => {
      const [, method, params] = payload;

      if (method !== RPCMethod.AuthVerify) {
        throw new Error(`Unexpected method '${method}' received by auth message signer`);
      }

      if (!params || typeof params !== "object" || !("challenge" in params)) {
        throw new Error("Auth verify payload is missing the challenge string");
      }

      const challenge = (params as { challenge: string }).challenge;

      return this.config.operatorAccount.signTypedData({
        domain: this.getAuthDomain(),
        types: EIP712AuthTypes,
        primaryType: "Policy",
        message: {
          scope: context.scope,
          application: context.application,
          participant: context.participant,
          expire: context.expire,
          allowances: context.allowances,
          challenge,
          wallet: this.operatorAddress,
        },
      });
    };
  }

  private resetAuthState(): void {
    this.authContext = null;
    this.messageSigner = null;
    this.isAuthenticated = false;
  }

  private get operatorAddress(): `0x${string}` {
    return this.config.operatorAccount.address;
  }

  private getAuthDomain() {
    return {
      name: this.config.appName,
    } as const;
  }

  private decodeFrame(data: WebSocket.RawData): string {
    if (typeof data === "string") {
      return data;
    }

    if (Buffer.isBuffer(data)) {
      return data.toString("utf8");
    }

    if (Array.isArray(data)) {
      return Buffer.concat(data).toString("utf8");
    }

    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString("utf8");
    }

    return Buffer.from(data as Uint8Array).toString("utf8");
  }
}
