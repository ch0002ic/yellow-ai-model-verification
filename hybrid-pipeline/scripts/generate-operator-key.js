#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FORCE_FLAG = "--force";
const HELP_FLAG = "--help";
const DEFAULT_OUTPUT = "./secrets/operator.key";

const args = process.argv.slice(2);

if (args.includes(HELP_FLAG)) {
  console.log(`Nitrolite Operator Key Generator\n\n` +
    `Usage: npm run generate:operator-key [output-path] [--force]\n\n` +
    `Arguments:\n` +
    `  output-path   Optional path for the key file (defaults to ${DEFAULT_OUTPUT})\n` +
    `  --force       Overwrite the file if it already exists\n`);
  process.exit(0);
}

const force = args.includes(FORCE_FLAG);
const outputArg = args.find((value) => value !== FORCE_FLAG);
const outputPath = outputArg ?? DEFAULT_OUTPUT;
const resolvedPath = path.isAbsolute(outputPath)
  ? outputPath
  : path.resolve(process.cwd(), outputPath);

if (!force && fs.existsSync(resolvedPath)) {
  console.error(`Refusing to overwrite existing key at '${resolvedPath}'. Pass --force to replace.`);
  process.exit(1);
}

const directory = path.dirname(resolvedPath);
fs.mkdirSync(directory, { recursive: true });

const key = `0x${randomBytes(32).toString("hex")}`;
fs.writeFileSync(resolvedPath, `${key}\n`, { mode: 0o600 });

try {
  fs.chmodSync(resolvedPath, 0o600);
} catch (error) {
  // Ignore chmod errors on platforms that do not support POSIX permissions.
}

console.log(`Generated Nitrolite operator private key at '${resolvedPath}'.`);
console.log("Remember to keep this file secret and excluded from version control.");
