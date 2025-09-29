import fs from "node:fs";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

export interface Environment {
  nitroliteRpcUrl: string;
  nitroliteAppId: string;
  nitroliteAppSecret: string;
  nitroliteAppName: string;
  nitroliteRpcHttpUrl: string;
  nitroliteClearNodeWsUrl: string;
  nitroliteChainId: number;
  nitroliteChainName: string;
  nitroliteOperatorPrivateKey: `0x${string}`;
  nitroliteChallengeDurationSeconds: bigint;
  nitroliteContracts: {
    custody: `0x${string}`;
    guestAddress: `0x${string}`;
    adjudicator: `0x${string}`;
  };
  port: number;
  environment: "development" | "production" | "test";
}

const numberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bigintFromEnv = (value: string | undefined, fallback: bigint) => {
  if (!value) {
    return fallback;
  }

  try {
    return BigInt(value);
  } catch {
    throw new Error(`Unable to parse bigint from environment value '${value}'`);
  }
};

const describeHexBytes = (length: number) => `${(length - 2) / 2}-byte`;

const hexFromEnv = (
  value: string | undefined,
  label: string,
  expectedLength = 66,
): `0x${string}` => {
  if (!value) {
    throw new Error(`Missing required environment variable '${label}'`);
  }

  if (!value.startsWith("0x")) {
    throw new Error(`Environment variable '${label}' must be a 0x-prefixed hex string`);
  }

  if (value.length !== expectedLength) {
    throw new Error(
      `Environment variable '${label}' must be a ${describeHexBytes(expectedLength)} hex string`,
    );
  }

  return value as `0x${string}`;
};

const optionalHexFromEnv = (
  value: string | undefined,
  label: string,
  fallback: `0x${string}`,
  expectedLength: number,
): `0x${string}` => {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  return hexFromEnv(value, label, expectedLength);
};

const normalisePrivateKey = (value: string, label: string): `0x${string}` => {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`Value for '${label}' is empty`);
  }

  const candidate = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return hexFromEnv(candidate, label, 66);
};

const tryReadKeyFile = (filePath: string): `0x${string}` | null => {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  try {
    if (!fs.existsSync(resolvedPath)) {
      return null;
    }

    const contents = fs.readFileSync(resolvedPath, "utf8");
    return normalisePrivateKey(contents, `NITROLITE_OPERATOR_PRIVATE_KEY_FILE (${resolvedPath})`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read operator private key from '${resolvedPath}': ${reason}`);
  }
};

const loadOperatorPrivateKey = (): `0x${string}` => {
  const configuredPath =
    process.env.NITROLITE_OPERATOR_PRIVATE_KEY_FILE ??
    process.env.NITROLITE_OPERATOR_PRIVATE_KEY_PATH;

  if (configuredPath) {
    const key = tryReadKeyFile(configuredPath);
    if (key) {
      return key;
    }
  }

  const defaultKey = tryReadKeyFile("./secrets/operator.key");
  if (defaultKey) {
    return defaultKey;
  }

  const envValue = process.env.NITROLITE_OPERATOR_PRIVATE_KEY;
  if (envValue) {
    return normalisePrivateKey(envValue, "NITROLITE_OPERATOR_PRIVATE_KEY");
  }

  throw new Error(
    "Missing Nitrolite operator private key. Provide NITROLITE_OPERATOR_PRIVATE_KEY or point to a key file via NITROLITE_OPERATOR_PRIVATE_KEY_FILE",
  );
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ADDRESS_HEX_LENGTH = ZERO_ADDRESS.length;
const MIN_CHALLENGE_DURATION_SECONDS = BigInt(3600);

const resolveChallengeDuration = (value: string | undefined) => {
  const duration = bigintFromEnv(value, MIN_CHALLENGE_DURATION_SECONDS);

  if (duration < MIN_CHALLENGE_DURATION_SECONDS) {
    throw new Error(
      `NITROLITE_CHALLENGE_DURATION_SECONDS must be at least ${MIN_CHALLENGE_DURATION_SECONDS.toString()} seconds`,
    );
  }

  return duration;
};

const env: Environment = {
  nitroliteRpcUrl: process.env.NITROLITE_RPC_URL ?? "",
  nitroliteAppId: process.env.NITROLITE_APP_ID ?? "",
  nitroliteAppSecret: process.env.NITROLITE_APP_SECRET ?? "",
  nitroliteAppName: process.env.NITROLITE_APP_NAME ?? "Nitrolite Verification Sandbox",
  nitroliteRpcHttpUrl: process.env.NITROLITE_RPC_HTTP_URL ?? "",
  nitroliteClearNodeWsUrl: process.env.NITROLITE_CLEAR_NODE_WS_URL ?? "",
  nitroliteChainId: numberFromEnv(process.env.NITROLITE_CHAIN_ID, 1),
  nitroliteChainName: process.env.NITROLITE_CHAIN_NAME ?? "Nitrolite Devnet",
  nitroliteOperatorPrivateKey: loadOperatorPrivateKey(),
  nitroliteChallengeDurationSeconds: resolveChallengeDuration(
    process.env.NITROLITE_CHALLENGE_DURATION_SECONDS,
  ),
  nitroliteContracts: {
    custody: optionalHexFromEnv(
      process.env.NITROLITE_CONTRACT_CUSTODY,
      "NITROLITE_CONTRACT_CUSTODY",
      ZERO_ADDRESS,
      ADDRESS_HEX_LENGTH,
    ),
    guestAddress: optionalHexFromEnv(
      process.env.NITROLITE_CONTRACT_GUEST_ADDRESS,
      "NITROLITE_CONTRACT_GUEST_ADDRESS",
      ZERO_ADDRESS,
      ADDRESS_HEX_LENGTH,
    ),
    adjudicator: optionalHexFromEnv(
      process.env.NITROLITE_CONTRACT_ADJUDICATOR,
      "NITROLITE_CONTRACT_ADJUDICATOR",
      ZERO_ADDRESS,
      ADDRESS_HEX_LENGTH,
    ),
  },
  port: numberFromEnv(process.env.PORT, 4000),
  environment: (process.env.NODE_ENV as Environment["environment"]) ?? "development",
};

export const requireEnv = () => {
  const requiredKeys = [
    "nitroliteRpcUrl",
    "nitroliteAppId",
    "nitroliteAppSecret",
    "nitroliteAppName",
    "nitroliteRpcHttpUrl",
    "nitroliteClearNodeWsUrl",
  ] as const;

  const missing = requiredKeys.filter((key) => env[key].length === 0);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
};

export default env;
