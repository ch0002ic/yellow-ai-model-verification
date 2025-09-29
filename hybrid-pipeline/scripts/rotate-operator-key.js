#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HELP_FLAG = "--help";
const FORCE_FLAG = "--force";
const UPDATE_ENV_FLAG = "--update-env";
const ENV_PATH_FLAG = "--env";
const NO_BACKUP_FLAG = "--no-backup";

const DEFAULT_KEY_PATH = "./secrets/operator.key";
const DEFAULT_ENV_PATH = "./.env";

const args = process.argv.slice(2);

if (args.includes(HELP_FLAG)) {
  console.log(`Nitrolite Operator Key Rotation\n\n` +
    `Usage: npm run rotate:operator-key [key-path] [options]\n\n` +
    `Arguments:\n` +
    `  key-path          Optional path to the operator key file (defaults to ${DEFAULT_KEY_PATH})\n\n` +
    `Options:\n` +
    `  --update-env      Replace NITROLITE_OPERATOR_PRIVATE_KEY in the env file\n` +
    `  --env <path>      Path to the env file to update (defaults to ${DEFAULT_ENV_PATH})\n` +
    `  --force           Overwrite an existing key file without prompting\n` +
    `  --no-backup       Skip creating a timestamped backup of the old key\n` +
    `  --help            Show this message\n`);
  process.exit(0);
}

let keyPath = DEFAULT_KEY_PATH;
let envPath = DEFAULT_ENV_PATH;
let updateEnv = false;
let force = false;
let createBackup = true;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  switch (arg) {
    case FORCE_FLAG:
      force = true;
      break;
    case UPDATE_ENV_FLAG:
      updateEnv = true;
      break;
    case ENV_PATH_FLAG: {
      const next = args[index + 1];
      if (!next) {
        console.error("Missing value for --env option");
        process.exit(1);
      }
      envPath = next;
      index += 1;
      break;
    }
    case NO_BACKUP_FLAG:
      createBackup = false;
      break;
    default:
      if (arg.startsWith("--")) {
        console.error(`Unknown option '${arg}'. Pass --help for usage.`);
        process.exit(1);
      }

      keyPath = arg;
  }
}

const resolvedKeyPath = path.isAbsolute(keyPath)
  ? keyPath
  : path.resolve(process.cwd(), keyPath);

const resolvedEnvPath = path.isAbsolute(envPath)
  ? envPath
  : path.resolve(process.cwd(), envPath);

if (fs.existsSync(resolvedKeyPath)) {
  if (!force && !createBackup) {
    console.error(
      `Refusing to overwrite existing key at '${resolvedKeyPath}'. ` +
        `Pass --force or omit --no-backup to proceed.`,
    );
    process.exit(1);
  }

  if (createBackup) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${resolvedKeyPath}.${timestamp}.bak`;
    fs.copyFileSync(resolvedKeyPath, backupPath);
    console.log(`Backed up current key to '${backupPath}'.`);
  }
}

const directory = path.dirname(resolvedKeyPath);
fs.mkdirSync(directory, { recursive: true });

const newKey = `0x${randomBytes(32).toString("hex")}`;
fs.writeFileSync(resolvedKeyPath, `${newKey}\n`, { mode: 0o600 });

try {
  fs.chmodSync(resolvedKeyPath, 0o600);
} catch {
  // Ignore chmod errors on platforms that do not support POSIX permissions.
}

console.log(`Rotated Nitrolite operator key at '${resolvedKeyPath}'.`);

if (updateEnv) {
  if (!fs.existsSync(resolvedEnvPath)) {
    console.warn(
      `Env file '${resolvedEnvPath}' not found. Skipping NITROLITE_OPERATOR_PRIVATE_KEY update.`,
    );
  } else {
    const contents = fs.readFileSync(resolvedEnvPath, "utf8");
    const pattern = /^NITROLITE_OPERATOR_PRIVATE_KEY=.*$/m;

    if (!pattern.test(contents)) {
      console.warn(
        `Env file '${resolvedEnvPath}' does not contain NITROLITE_OPERATOR_PRIVATE_KEY. Skipping update.`,
      );
    } else {
      const updated = contents.replace(pattern, `NITROLITE_OPERATOR_PRIVATE_KEY=${newKey}`);
      fs.writeFileSync(resolvedEnvPath, updated);
      console.log(`Updated NITROLITE_OPERATOR_PRIVATE_KEY in '${resolvedEnvPath}'.`);
    }
  }
}

console.log("Remember to restart any running processes that rely on the operator key.");
