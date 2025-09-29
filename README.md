# Real-Time AI Model Verification Network (Nitrolite Build)

This project bootstraps the **Real-Time AI Model Verification Network** envisioned for the Yellow Network Hackathon 2025. It is engineered around the [@erc7824/nitrolite](https://github.com/erc7824) SDK to provide gasless, real-time, cross-chain-verifiable AI inference auditing via ERC-7824 state channels.

## Key Characteristics

- **Nitrolite Native** – Off-chain verification sessions are orchestrated through ERC-7824 state channels for instant, gasless UX backed by the official Nitrolite SDK.
- **Telemetry-Driven** – A realtime collector maintains channel, verification, and automation metrics that stream to the UI via Server-Sent Events.
- **SQLite Persistence** – ClearNode event history is durably captured using `better-sqlite3`, enabling cold-start hydration and replay.
- **Modular Services** – Config-driven architecture with discrete components for environment loading, Nitrolite connectivity, verification engines, and data sinks.

## Repository Layout

```
.
├── docs/                              # Hackathon notes and planning artefacts
├── public/                            # Dashboard HTML, CSS, and client-side JS
├── scripts/                           # Operator key helpers
├── src/
│   ├── config/environment.ts          # Typed env loading + validation
│   ├── core/                          # Nitrolite clients, verification engine
│   ├── persistence/                   # SQLite ClearNode event repository
│   ├── runtime/                       # Channel store, telemetry collector
│   ├── server/                        # Express API + SSE streaming
│   └── utils/logger.ts                # Pino logger configuration
├── package.json
├── tsconfig.json
└── README.md
```

## Quick Start

```bash
npm install
npm run dev
```

The development server now serves both the REST API and a lightweight dashboard at `http://localhost:4000`.

### REST API

Available endpoints:

- `POST /api/verifications` to register a new inference verification request.
- `POST /api/verifications/:id/resolve` to mark an inference as `verified`/`failed` and trigger channel closure.
- `GET /api/verifications/:id` to retrieve verification status, channel metadata, and cryptographic attestations.
- `GET /api/verifications` to list all verifications currently tracked in memory.
- `GET /api/metrics` to fetch the latest automation + telemetry snapshot.
- `GET /api/clearnode/events` to inspect the most recent ClearNode channel and balance updates captured from the WebSocket stream.
- `GET /api/clearnode/events/stream` to consume a Server-Sent Events feed with live ClearNode telemetry snapshots.

### Frontend dashboard

Navigate to `http://localhost:4000/` (or `http://localhost:4000/dashboard`) to access the real-time Nitrolite dashboard:

- Submit new verification requests without cURL.
- Review active/closed verifications and resolve them inline.
- Monitor ClearNode channel/balance telemetry with live metrics and an event log.
- Drill into per-channel timelines that hydrate automatically when new updates arrive over the SSE stream.

These endpoints talk to a Nitrolite-backed channel service that lazily establishes a wallet-backed connection, retrieves open channel metadata, and prepares verification sessions ready to be enriched with real model attestations, zero-knowledge proofs, and audit storage.

## Environment Configuration

Copy `.env.example` to `.env` and configure the properties below. All Nitrolite settings align with the official SDK workflow (channel creation via apps.yellow.com, ClearNode WebSocket connectivity, and on-chain RPC access):

```
NITROLITE_RPC_URL=
NITROLITE_APP_ID=
NITROLITE_APP_SECRET=
NITROLITE_APP_NAME=
NITROLITE_RPC_HTTP_URL=
NITROLITE_CLEAR_NODE_WS_URL=
NITROLITE_CHAIN_ID=
NITROLITE_CHAIN_NAME=
NITROLITE_OPERATOR_PRIVATE_KEY=
NITROLITE_CHALLENGE_DURATION_SECONDS=
NITROLITE_CONTRACT_CUSTODY=
NITROLITE_CONTRACT_GUEST_ADDRESS=
NITROLITE_CONTRACT_ADJUDICATOR=
PORT=4000
```

> ⚠️ Never commit secrets. These values should remain local or be injected via deployment secrets.

> 💡 When targeting the Yellow sandbox, set `NITROLITE_CLEAR_NODE_WS_URL=wss://clearnet-sandbox.yellow.com/ws`. If you see
> `Unexpected server response: 200` in the logs, double-check that the URL points to a WebSocket-capable gateway (the
> production REST endpoint at `clearnet.yellow.org` will answer with HTTP 200 but will not upgrade the connection).

The Nitrolite SDK enforces a minimum challenge duration of 3,600 seconds. Ensure `NITROLITE_CHALLENGE_DURATION_SECONDS` is set to `3600` or higher for successful bootstrap.

### Operator Private Key Setup

The operator key is a production-grade secret. Prefer loading it from a file instead of keeping it inline in `.env`.

```bash
# Generate a fresh 32-byte private key (hex encoded)
openssl rand -hex 32 > ./secrets/operator.key

# Ensure the key stays 0x-prefixed and has the correct permissions
chmod 600 ./secrets/operator.key
echo "0x$(cat ./secrets/operator.key | tr -d '\n')" > ./secrets/operator.key

# Point the application at the file (recommended)
echo "NITROLITE_OPERATOR_PRIVATE_KEY_FILE=./secrets/operator.key" >> .env

# Or inject the value directly (less secure)
export NITROLITE_OPERATOR_PRIVATE_KEY=0xYour32ByteHexKey
```

`NITROLITE_OPERATOR_PRIVATE_KEY_FILE` and `NITROLITE_OPERATOR_PRIVATE_KEY_PATH` will both load the file content, trim whitespace, and enforce the 32-byte requirement. The direct environment variable still works, but avoid committing it to disk or source control.

Prefer tooling? The repo ships with a helper that generates the key and writes it to `./secrets/operator.key` (the default location automatically detected by the loader):

```bash
npm run generate:operator-key

# optionally, pick a custom path
npm run generate:operator-key -- ./secrets/nitrolite/operator.key

# rotate the existing key, back up the old one, and update .env in one step
npm run rotate:operator-key -- --update-env
```

Pass `--force` to overwrite an existing file. Remember to add your secrets directory to `.gitignore` if you customise the path.

## ClearNode RPC Integration

`NitroliteChannelService` now coordinates channel lifecycle with the ClearNode app API before handing payloads to the on-chain Nitrolite SDK. The workflow currently assumes a Basic-authenticated REST surface exposed at `NITROLITE_RPC_URL`:

- `POST /channels` – returns a signed channel bootstrap (fixed part, unsigned initial state, server signature, and optional funding directives). The service automatically performs token approval + `depositAndCreateChannel` when funding is required, otherwise it issues `createChannel` directly.
- `POST /channels/:channelId/close` – returns the ClearNode-signed final state and opaque closure metadata used to execute `closeChannel` on-chain.

If the RPC call fails, the service falls back to reusing any existing Nitrolite channel and degrades gracefully to an ephemeral session so that verification can continue during outages. Successful responses are captured inside each verification session’s metadata, including transaction hashes and ClearNode session keys, making it straightforward to audit the full lifecycle later on.

### Sandbox Resources

For forthcoming WebSocket and signing flows, the Yellow sandbox stack is available:

- ClearNode WebSocket: `wss://clearnet-sandbox.yellow.com/ws`
- Testnet faucet:

	```bash
	curl -X POST https://clearnet-sandbox.yellow.com/faucet/requestTokens \
		-H "Content-Type: application/json" \
		-d '{"userAddress":"0xYourOperatorAddress"}'
	```

- Documentation: https://docs.yellow.org/

> ℹ️  When implementing the EIP-712 `auth_verify` handshake, the sandbox currently expects a minimal domain like:

```ts
const getAuthDomain = () => ({
	name: "Name of the Application",
});
```

### WebSocket Bootstrap Preview

`ClearNodeWebSocketClient` establishes a long-lived connection to the sandbox gateway during bootstrap. At the moment it logs inbound frames and prepares a stubbed `auth_request` payload (via `createAuthRequestMessage`) so the EIP-712 signing surface is ready. The next iteration will wire in the full `auth_request → auth_verify` handshake and channel lifecycle streaming.

## Next Steps

1. Implement real cryptographic verification primitives (ZK proofs, signature checks).
2. Layer in ClearNode WebSocket streaming so the backend can react to mid-session state updates and disputes in real time.
3. Extend the verification engine with policy enforcement (bias, drift, anomaly detection).
4. Add persistence (SQL/NoSQL) for audit trails and dashboards.
5. Implement the companion frontend that consumes the REST API and visualises verification proofs in real time.
6. Add end-to-end tests that cover SSE telemetry, demo-mode fallbacks, and automated resolution flows.

## Hackathon Deliverables Alignment

- **Nitrolite SDK Usage:** Core session lifecycle is executed through the Nitrolite client.
- **Creativity & Innovation:** Establishes the first verifiable AI transparency fabric using ERC-7824 channels.
- **Technical Execution:** Modular TypeScript codebase with clear separation of concerns and future-proofing for production-hardening.
- **Real-World Utility:** Tackles enterprise AI trust, compliance, and audit pain points.
- **Scalability & Adoption:** Chain-agnostic design enables cross-industry deployment and marketplace integrations.
- **Yellow Tech Impact:** Demonstrates immediate cost (gasless), speed (off-chain), and UX (web2-like) advantages enabled by Nitrolite.
