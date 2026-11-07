# luminary
Luminary bridges local fiat economies with global decentralized finance, enabling users to trade USDC for local currency securely, instantly, and with near-zero fees.

## Stack

- **Frontend:** React 18 + Vite + Tailwind CSS, React Router, Freighter wallet, `@stellar/stellar-sdk` (Stellar **Testnet**).
- **Backend:** Node.js (ESM) + Express 5 in [`server/`](server), PostgreSQL via `pg` (node-postgres).
- **Auth:** email + password (bcrypt), JWT stored in an `httpOnly`, `SameSite=Strict` cookie. Each JWT carries a random `jti`, and logout revokes that token on the server.
- **Redis** (optional in development): login/register rate-limit counters and the token revocation list, shared across API processes.

## Setup

### 1. Requirements

- Node.js ≥ 20
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
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | `postgres://user:pass@host:port/db`. If empty, the standard `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` are used. |
| `JWT_SECRET` | **Required**, ≥ 32 characters. |
| `PORT` / `HOST` | API listen address (default `127.0.0.1:4000`). The Vite dev proxy reads `PORT`. |
| `NODE_ENV` | `production` enables `Secure` cookies (requires HTTPS). |
| `REDIS_URL` | e.g. `redis://127.0.0.1:6379`. Empty → in-memory fallback (single process only). |
| `VERIFY_STELLAR_TX` | `true` (default): when a seller releases a trade, the API checks on Horizon that the tx really pays the USDC to the buyer. |

`.env` is git-ignored; never commit it.

### 5. Install, migrate, run

```bash
npm install
npm run db:migrate   # idempotent: creates/updates tables, safe to re-run
npm run dev          # API on :4000 + Vite on :5173 (/api is proxied to the API)
```

Open http://localhost:5173. If the API is not running, the market falls back to demo offers.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API (`node --watch`) + Vite dev server, via `concurrently` |
| `npm run server` | API only |
| `npm run db:migrate` | Apply `server/db/schema.sql` in a transaction |
| `npm run test:smoke` | End-to-end API checks against a running API (`API_URL`, default `http://127.0.0.1:4000`). Run the API with `VERIFY_STELLAR_TX=false`, since it uses fake tx hashes. Creates test users in the DB, so use a throwaway database. The last check uses up the login rate limit for 15 min. Before re-running, restart the API (memory mode) or clear the counters: `redis-cli --scan --pattern 'luminary:rl:*' \| xargs redis-cli del`. |
| `npm run build` | Production build of the frontend |

## API

All routes are under `/api`. Mutations must send `Content-Type: application/json`. Validation errors return `400 { error, details: { field: message } }`.

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | – | API, DB and cache status (`cache: redis \| memory \| unavailable`) |
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
| POST | `/trades/:id/paid` | ✔ buyer | Buyer marks the fiat payment as sent |
| POST | `/trades/:id/release` | ✔ seller | `{ txHash }` of the USDC payment to the buyer (verified on Horizon) |
| POST | `/trades/:id/cancel` | ✔ party | Cancel (either party while `pending`; buyer also while `paid`) and return USDC to the offer |
| POST | `/trades/:id/dispute` | ✔ party | Open a dispute after payment (resolved manually for now) |

Offer `type: "sell"` means the creator sells USDC. Trade flow: `pending → paid → released`, with `cancelled` / `disputed` as side exits.
