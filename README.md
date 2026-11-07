# luminary
Luminary bridges local fiat economies with global decentralized finance, enabling users to trade USDC for local currency securely, instantly, and with near-zero fees.

## Stack

- **Frontend:** React 18 + Vite + Tailwind CSS, React Router, Freighter wallet, `@stellar/stellar-sdk` v17 (Stellar **Testnet**).
- **Escrow:** Soroban smart contract [`luminary-escrow`](contract-luminary/contracts/escrow) holds the seller's USDC until it is released to the buyer or refunded. See [contract-luminary/README.md](contract-luminary/README.md).
- **Backend:** Node.js (ESM) + Express 5 in [`server/`](server), PostgreSQL via `pg` (node-postgres).
- **Auth:** email + password (bcrypt), JWT stored in an `httpOnly`, `SameSite=Strict` cookie. Each JWT carries a random `jti`, and logout revokes that token on the server.
- **Redis** (optional in development): login/register rate-limit counters and the token revocation list, shared across API processes.
- **Ops:** pino JSON logs with request ids, liveness/readiness probes, graceful shutdown, strict env validation, tracked migrations, Docker image + Compose stack, GitHub Actions CI. Deployment guide: [docs/PRODUCTION.md](docs/PRODUCTION.md).

## Setup

### 1. Requirements

- Node.js ≥ 22.12 to run the API (required by `@stellar/stellar-sdk` v17). The dev/test toolchain needs ≥ 22.22.2 (jsdom 31); `.nvmrc` tracks the latest Node 22, which CI uses.
- PostgreSQL ≥ 13
- Redis ≥ 6 (recommended; required when running more than one API process)
- [Freighter](https://freighter.app) browser extension set to **Testnet** (to sign Stellar transactions)

### 2. Create the database

With a local PostgreSQL install:

```bash
sudo -u postgres psql -c "CREATE ROLE luminary LOGIN PASSWORD 'change-me';"
sudo -u postgres psql -c "CREATE DATABASE luminary OWNER luminary;"
```

Or with Docker (bound to localhost only):

```bash
docker run -d --name luminary-pg -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=luminary -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=luminary \
  postgres:17-alpine
```

### 3. Start Redis

```bash
docker run -d --name luminary-redis -p 127.0.0.1:6379:6379 \
  redis:7-alpine redis-server --appendonly yes
```

`--appendonly yes` persists data across Redis restarts. Bind it to localhost (or a private network), and set a password (`--requirepass`, then `REDIS_URL=redis://:password@host:6379`) if it is reachable from other hosts.

How the API uses Redis (`server/cache/`):

- **`REDIS_URL` unset** → counters and revoked tokens are kept in process memory. Fine for a single dev process. At startup the API logs `[cache] REDIS_URL no definido: … en MEMORIA del proceso` plus a warning that logout only invalidates a token in that process and is forgotten on restart.
- **`REDIS_URL` set** → counters live in Redis under the `luminary:` key prefix, shared by every API process.
- **`REDIS_URL` set but Redis down (fail-safe)** → the API still starts and keeps reconnecting in the background. Until Redis comes back, routes that need it return **503** instead of running without limits or skipping the revocation check: `/auth/login`, `/auth/register`, every authenticated route, and `/auth/logout` (which still clears the cookie, but the 503 tells the client the token was not revoked on the server). `/health` reports `cache: "unavailable"` with status 503. Public read routes keep working. The API recovers by itself once Redis is reachable again.

#### Token revocation

On logout, the API stores `revoked:jti:<jti>` in the cache, with a TTL equal to the token's remaining lifetime (≤ 7 days). After that the token has expired anyway. `requireAuth` rejects revoked tokens, and tokens without a `jti` (issued before this change), with 401. Replaying a cookie copied before logout therefore fails. Use `--appendonly yes` so revocations survive a Redis restart.

### 4. Configure the environment

```bash
cp .env.example .env
# generate a JWT secret and paste it into .env as JWT_SECRET
openssl rand -hex 48
```

The API validates its environment at boot and exits with a list of every problem (weak or placeholder `JWT_SECRET`, malformed values, and in production missing Redis/escrow/`PUBLIC_ORIGIN`). The most common variables are below; the full reference, including pool, proxy, CORS and logging settings, is in [docs/PRODUCTION.md](docs/PRODUCTION.md#environment-variables).

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | `postgres://user:pass@host:port/db`. If empty, the standard `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` are used. |
| `JWT_SECRET` | **Required**, ≥ 32 characters, ≥ 128 bits of estimated entropy, not a placeholder. |
| `PORT` / `HOST` | API listen address (default `127.0.0.1:4000`). The Vite dev proxy reads `PORT`. |
| `NODE_ENV` | `production` enables `Secure` cookies (requires HTTPS) and the production checks. |
| `REDIS_URL` | e.g. `redis://127.0.0.1:6379`. Empty → in-memory fallback (single process only). |
| `ESCROW_CONTRACT_ID` | Deployed `luminary-escrow` contract (`C…`). Testnet deployment: `CA77HZ3YHCNKXG6M2OZKN7QAI7UDEEOX2AHDEQU5LO4DTD7QHI6K6BOI`. Without it, funding returns 503 when verification is on. |
| `VERIFY_STELLAR_TX` | `true` (default): every escrow step (fund / release / refund) is verified on-chain through Soroban RPC before the trade changes state. Set `false` **only** for local tests without network access (`npm run test:smoke`). |
| `SOROBAN_RPC_URL` | Default `https://soroban-testnet.stellar.org`. |
| `STELLAR_NETWORK_PASSPHRASE` | Default: Testnet. |
| `USDC_ISSUER` / `ESCROW_TOKEN_ID` | Escrow token. Defaults to the Stellar Asset Contract of testnet USDC (`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`). `ESCROW_TOKEN_ID` overrides it with any SAC id. |
| `VITE_SOROBAN_RPC_URL` | Frontend Soroban RPC (default testnet). The frontend gets the contract and token ids from the API (`trade.escrow`), so the server config is the single source of truth. |

`.env` is git-ignored; never commit it.

### 5. Install, migrate, run

```bash
npm install
npm run db:migrate   # applies pending migrations, tracked in schema_migrations; safe to re-run
npm run dev          # API on :4000 + Vite on :5173 (/api is proxied to the API)
```

Open http://localhost:5173. If the API is not running, the market falls back to demo offers.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API (`node --watch`) + Vite dev server, via `concurrently` |
| `npm run server` | API only |
| `npm run db:migrate` | Apply pending `server/db/migrations/NNN_*.sql`, each in its own transaction, recorded with a checksum in `schema_migrations`. `-- --status` lists applied/pending. Never edit an applied migration; add a new one. |
| `npm run lint` / `npm run format:check` | ESLint / Prettier (`lint:fix`, `format` to fix) |
| `npm test` | Vitest: server unit tests, integration tests (only with `TEST_DATABASE_URL`), frontend tests. `npm run test:coverage` adds a coverage report in `coverage/` |
| `npm run test:smoke` | End-to-end API checks against a running API (`API_URL`, default `http://127.0.0.1:4000`). Run the API with `VERIFY_STELLAR_TX=false`, since it uses fake tx hashes. Creates test users in the DB, so use a throwaway database. The last check uses up the login rate limit for 15 min. Before re-running, restart the API (memory mode) or clear the counters: `redis-cli --scan --pattern 'luminary:rl:*' \| xargs redis-cli del`. |
| `npm run test:escrow-e2e` | Real **testnet** escrow flow without a browser: throwaway Friendbot accounts, a test token and its SAC, then create → release and create → refund with the frontend escrow client (keypair signer) and the server verifiers, plus negative cases. Needs `ESCROW_CONTRACT_ID` and internet access. |
| `npm run build` | Production build of the frontend |

### Tests

```bash
npm test                      # unit + frontend tests; integration tests are skipped
# integration tests need throwaway Postgres and Redis (they TRUNCATE the tables):
docker run -d --rm --name lum-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=luminary_test -p 127.0.0.1:55432:5432 postgres:17-alpine
docker run -d --rm --name lum-redis -p 127.0.0.1:56379:6379 redis:7-alpine
TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/luminary_test \
TEST_REDIS_URL=redis://127.0.0.1:56379/1 npm run test:coverage
docker stop lum-pg lum-redis
```

Escrow verification is tested against a mocked Soroban RPC that returns real XDR built with the SDK; `npm run test:escrow-e2e` covers the real testnet path.

### Docker

```bash
cp .env.example .env   # set JWT_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD, PUBLIC_ORIGIN
docker compose up -d --build
curl http://127.0.0.1:8080/api/health
```

One image serves the API and the built SPA. Compose adds PostgreSQL, Redis (AOF) and a one-shot `migrate` service. See [docs/PRODUCTION.md](docs/PRODUCTION.md).

## API

All routes are under `/api`. Mutations must send `Content-Type: application/json`. Validation errors return `400 { error, details: { field: message } }`.

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health/live` | – | Liveness: the process answers (no dependency checks) |
| GET | `/health/ready` | – | Readiness: DB + cache reachable and not shutting down, else 503 (`cache: redis \| memory \| unavailable`) |
| GET | `/health` | – | Alias of `/health/ready` |
| POST | `/auth/register` | – | `{ email, password, displayName }` → sets session cookie |
| POST | `/auth/login` | – | `{ email, password }` (rate-limited: 10 failures / 15 min / IP) |
| POST | `/auth/logout` | – | Revokes the current JWT (`jti`) on the server and clears the cookie |
| GET | `/auth/me` | ✔ | Current user |
| PATCH | `/users/me` | ✔ | `{ displayName?, stellarAddress? }` (`null` unlinks the address) |
| GET | `/offers` | – | Active offers. Query: `type=buy\|sell`, `currency`, `limit` |
| GET | `/offers/mine` | ✔ | My offers, any status |
| GET | `/offers/:id` | – | Offer detail |
| POST | `/offers` | ✔ | `{ type, currency, price, usdcAmount, min?, max?, paymentMethod, bank? }` |
| PATCH | `/offers/:id` | ✔ owner | Edit / pause (`status: paused`) / reactivate |
| DELETE | `/offers/:id` | ✔ owner | Close (soft) |
| GET | `/trades` | ✔ | My trades. Query: `status` |
| GET | `/trades/:id` | ✔ party | Trade detail |
| POST | `/trades` | ✔ | Take an offer: `{ offerId, usdcAmount }` (reserves the USDC on the offer) |
| POST | `/trades/:id/fund` | ✔ seller | `{ txHash }` of the escrow `create` call. Checks that the tx invoked our contract for `(seller, trade id)` and that the on-chain escrow is `Funded` with the right buyer, token and amount. `pending → funded` |
| POST | `/trades/:id/paid` | ✔ buyer | Buyer marks the fiat payment as sent (`funded → paid`) |
| POST | `/trades/:id/release` | ✔ seller | `{ txHash }` of the escrow `release` call. On-chain state must be `Released`. `funded/paid/disputed → released` |
| POST | `/trades/:id/refund` | ✔ party | `{ txHash }` of the escrow `refund` call (buyer backs out, or seller reclaims after the timeout). On-chain state must be `Refunded`. The USDC goes back to the offer. `funded/paid/disputed → refunded` |
| POST | `/trades/:id/cancel` | ✔ party | Cancel while `pending`, before any escrow. Returns the USDC to the offer. Once funds are in escrow, use `/refund`. |
| POST | `/trades/:id/dispute` | ✔ party | Open a dispute after payment (resolved manually for now) |

Offer `type: "sell"` means the creator sells USDC.

## Trade flow (on-chain escrow)

```
pending ──fund (seller signs create)──▶ funded ──buyer pays fiat──▶ paid ──release (seller)──▶ released
   │                                      │                          │
   └──cancel──▶ cancelled                 └──── refund (buyer any time / seller after ~24 h) ──▶ refunded
                                                                     └──dispute──▶ disputed (status only; release/refund still possible)
```

1. **Taking an offer** opens a `pending` trade and reserves the amount on the offer.
2. **Fund:** the seller deposits the USDC in the escrow contract (Freighter signs `create`). The API verifies it and moves the trade to `funded`. Before funding, the UI checks that the buyer has a USDC trustline. Without one, the release would fail.
3. **Pay:** the buyer sends the fiat off-chain and marks the trade `paid`. This is only allowed once the funds are locked.
4. **Release:** the seller signs `release`, and the contract pays the buyer. The API verifies it, and the trade becomes `released`.
5. **Refund:** the buyer can back out at any time (the USDC goes back to the seller). The seller can reclaim on their own once the ~24 h ledger timeout has passed. The trade becomes `refunded` and the offer gets the amount back.

The browser stores each escrow tx hash in `localStorage` as soon as the network accepts it. If registering it with the API fails, the UI offers **retry** instead of sending a second transaction. A tx sent from another tool can also be registered by hash.

**Safety notes**

- The contract has no admin. A dispute is only a Luminary status and cannot move funds. Once the timeout has passed, the seller can reclaim funds that were never released, **even if the buyer already paid**. Buyers should only pay after `funded`, and sellers should release promptly.
- If the seller funds on-chain but never registers the tx, and the trade is then cancelled, the USDC stays in the contract. The seller reclaims it after the timeout, or the buyer can refund it.
- Trades opened before the escrow migration have no escrow. They can only be cancelled.

