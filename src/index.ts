import env, { requireEnv } from "./config/environment.js";
import { ClearNodeClient } from "./core/ClearNodeClient.js";
import { NitroliteConnectionFactory } from "./core/NitroliteConnectionFactory.js";
import { NitroliteChannelService } from "./core/NitroliteChannelService.js";
import { VerificationEngine } from "./core/VerificationEngine.js";
import { ClearNodeWebSocketClient } from "./core/ClearNodeWebSocketClient.js";
import { ApiServer } from "./server/ApiServer.js";
import logger from "./utils/logger.js";
import { ChannelEventStore } from "./runtime/ChannelEventStore.js";
import { ClearNodeEventRepository } from "./persistence/ClearNodeEventRepository.js";
import { TelemetryCollector } from "./runtime/TelemetryCollector.js";

async function bootstrap() {
  try {
    requireEnv();

    const connectionFactory = new NitroliteConnectionFactory();
    const clearNodeClient = new ClearNodeClient({
      baseUrl: env.nitroliteRpcUrl,
      appId: env.nitroliteAppId,
      appSecret: env.nitroliteAppSecret,
    });

    const nitrolite = new NitroliteChannelService(connectionFactory, clearNodeClient);
    nitrolite.initialise();

    const operatorAccount = connectionFactory.getOperatorAccount();

    const eventRepository = new ClearNodeEventRepository();
    const channelEventStore = new ChannelEventStore(eventRepository);
    const telemetryCollector = new TelemetryCollector();
    telemetryCollector.ingestSnapshot(channelEventStore.snapshot());
    const unsubscribeTelemetry = channelEventStore.subscribe((update) => {
      telemetryCollector.recordChannelEvent(update);
    });
    const clearNodeWebSocket = new ClearNodeWebSocketClient({
      url: env.nitroliteClearNodeWsUrl,
      appName: env.nitroliteAppName,
      operatorAccount,
    });

    clearNodeWebSocket.on("authenticated", () => {
      logger.info("ClearNode WebSocket session authenticated; event streaming active");
    });

    clearNodeWebSocket.on("channelsUpdate", (payload) => {
      channelEventStore.recordChannelsUpdate(payload);
      logger.debug({ count: payload.length }, "Recorded ClearNode channels_update payload");
    });

    clearNodeWebSocket.on("channelUpdate", (payload) => {
      channelEventStore.recordChannelUpdate(payload);
      const channelId =
        (payload as { channelId?: string; channel_id?: string }).channelId ??
        (payload as { channel_id?: string }).channel_id;
      logger.debug({ channelId }, "Recorded ClearNode channel_update payload");
    });

    clearNodeWebSocket.on("balanceUpdate", (payload) => {
      channelEventStore.recordBalanceUpdate(payload);
      logger.debug({ count: payload.length }, "Recorded ClearNode balance_update payload");
    });

    const verificationEngine = new VerificationEngine(nitrolite, telemetryCollector);
    const server = new ApiServer(
      verificationEngine,
      channelEventStore,
      eventRepository,
      telemetryCollector,
    );

    try {
      await clearNodeWebSocket.connect();
    } catch (error) {
      logger.warn(
        { err: error },
        "Failed to establish ClearNode WebSocket during bootstrap; continuing without streaming",
      );
    }
    await server.start();
    logger.info("Real-Time AI Model Verification Network initialised");

    const shutdown = async (signal: NodeJS.Signals) => {
      logger.info({ signal }, "Received shutdown signal");
      await clearNodeWebSocket
        .disconnect()
        .catch((error: unknown) =>
          logger.warn({ error }, "Failed to close ClearNode WebSocket during shutdown"),
        );
      await server
        .stop()
        .catch((error: unknown) =>
          logger.warn({ error }, "Failed to stop API server during shutdown"),
        );
      unsubscribeTelemetry();
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    logger.fatal({ err: error }, "Failed to bootstrap application");
    process.exit(1);
  }
}

void bootstrap();
