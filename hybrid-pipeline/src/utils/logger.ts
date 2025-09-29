import { createRequire } from "node:module";

import pino from "pino";
import type { TransportSingleOptions } from "pino";

const level = process.env.LOG_LEVEL ?? "info";

const requireModule = createRequire(import.meta.url);

const getTransport = () => {
  if (process.env.NODE_ENV === "production") {
    return undefined;
  }

  try {
    requireModule.resolve("pino-pretty");
    return {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
      },
    } as TransportSingleOptions;
  } catch (error) {
    const message = error instanceof Error ? error.message : "pino-pretty module not available";
    console.warn(
      `Pretty logger disabled: unable to load pino-pretty (${message}). Install it or set NODE_ENV=production to silence this warning.`,
    );
    return undefined;
  }
};

export const logger = pino({
  name: "nitrolite-ai-verification",
  level,
  transport: getTransport(),
});

export default logger;
