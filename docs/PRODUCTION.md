# Luminary in production

Operational guide for running Luminary outside a laptop: deployment checklist, configuration
reference, secrets, data stores, proxy/TLS, observability, and moving the escrow to Stellar
mainnet. The repository is production-*ready* on the application side; the items under
[Known limits](#known-limits) and [Open blockers](#open-blockers-before-a-real-money-launch) still need a decision before handling real money.

- [Architecture](#architecture)
- [Deployment checklist](#deployment-checklist)
- [Environment variables](#environment-variables)
- [Secrets management](#secrets-management)
- [Running it](#running-it)
- [Reverse proxy and TLS](#reverse-proxy-and-tls)
- [PostgreSQL: migrations, pooling, backups](#postgresql)
- [Redis: persistence and sizing](#redis)
- [Health checks, shutdown and scaling](#health-checks-shutdown-and-scaling)
- [Logging, monitoring and alerting](#logging-monitoring-and-alerting)
- [Frontend build](#frontend-build)
- [Mainnet migration (escrow contract)](#mainnet-migration-escrow-contract)
- [Known limits](#known-limits)
- [Open blockers before a real-money launch](#open-blockers-before-a-real-money-launch)

## Architecture

```
browser ──HTTPS──▶ reverse proxy (TLS, HSTS) ──HTTP──▶ luminary-api (Express, serves the SPA from /app/dist)
   │                                                     ├──▶ PostgreSQL  (users, offers, trades, schema_migrations)
   │                                                     ├──▶ Redis       (login/register rate limits, revoked JWT ids)
   │                                                     └──▶ Soroban RPC (verifies every escrow tx before a state change)
   └──▶ Freighter / Horizon / Soroban RPC (the browser builds and signs escrow transactions itself)
```

The API is stateless: run as many replicas as needed as long as they share PostgreSQL and Redis.
Session = JWT in an `httpOnly`, `SameSite=Strict`, `Secure` (production) cookie; logout revokes the
token's `jti` in Redis. Funds never touch the server: the Soroban contract holds them, and the API
only records state after verifying the transaction on-chain.

## Deployment checklist

Before the first deploy

- [ ] Secrets generated (not reused from dev): `JWT_SECRET`, PostgreSQL and Redis passwords → [Secrets](#secrets-management).
- [ ] `NODE_ENV=production`. The API refuses to start unless `REDIS_URL`, `ESCROW_CONTRACT_ID`, an `https://` `PUBLIC_ORIGIN` and `VERIFY_STELLAR_TX=true` are set and no example password is used.
- [ ] TLS terminated by a reverse proxy that **overwrites** `X-Forwarded-For`; `TRUST_PROXY` set to that proxy's hop count or IP (never `true`) → [Proxy](#reverse-proxy-and-tls).
- [ ] PostgreSQL ≥ 13 with automated backups **and a tested restore** → [Backups](#backups-and-restore).
- [ ] Redis with AOF persistence, a password, `maxmemory-policy noeviction`, not reachable from the Internet → [Redis](#redis).
- [ ] `npm run db:migrate` (or the compose `migrate` service) runs before the new API version receives traffic.
- [ ] Image base pinned by digest and rebuilt regularly; `npm audit --omit=dev` reviewed (CI reports it).
- [ ] Log shipping, uptime checks on `/api/health/ready` and the alerts below configured → [Monitoring](#logging-monitoring-and-alerting).
- [ ] Frontend built for the right network (`VITE_STELLAR_NETWORK`, RPC, USDC issuer) → [Frontend build](#frontend-build).
- [ ] Mainnet only: contract audited and redeployed, issuer/RPC set → [Mainnet](#mainnet-migration-escrow-contract).
- [ ] Terms of service, KYC/AML and money-transmission obligations reviewed by counsel for each fiat corridor (outside this repo, but a launch blocker).

Every release

- [ ] CI green (lint, tests with Postgres/Redis, smoke test, build, Docker image, contract tests and WASM build).
- [ ] Migrations reviewed: additive and backwards compatible with the previous API version (old replicas keep serving during a rolling deploy).
- [ ] Rolling deploy: new replica → readiness `200` → old replica gets `SIGTERM` (drains for `SHUTDOWN_TIMEOUT_MS`).
- [ ] Post-deploy: `/api/health/ready` is `200`, error rate and p95 latency flat, a login + offer listing works.
- [ ] Rollback plan: previous image tag; migrations are forward-only, so a rollback must stay compatible with the new schema.

## Environment variables

The API validates all of these at boot (`server/config.js`) and exits with **every** problem listed.
CLI tools (`npm run db:migrate`) only need the database variables.

| Variable | Default | Production | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | `production` | `development` \| `test` \| `production`. Production enables `Secure` cookies, HSTS, CSP `upgrade-insecure-requests` and the checks in this column. |
| `JWT_SECRET` | – | **required** | ≥ 32 chars, ≥ 128 bits of estimated entropy, not a placeholder. `openssl rand -hex 48`. Rotating it logs everyone out. |
| `HOST` / `PORT` | `127.0.0.1` / `4000` | `0.0.0.0` in containers | Listen address. |
| `PUBLIC_ORIGIN` | – | **required**, `https://` | Public URL of the SPA. Mutating requests from any other `Origin` get 403. `http://localhost` is accepted for local production-mode runs. |
| `CORS_ORIGINS` | – | usually empty | Comma-separated extra origins that get CORS headers with credentials. Only needed if the SPA is served from another origin of the same site. |
| `TRUST_PROXY` | `loopback` (dev) / `false` (production) | hop count or proxy IP/CIDR | Value for Express `trust proxy`, validated at boot: `false`/`0`, a hop count `1`–`10`, or a comma list of IPs, CIDRs, `loopback`, `linklocal`, `uniquelocal`. `true` and anything else are rejected. Determines the client IP used by the per-IP login/register limits. In production it defaults to `false` (`X-Forwarded-For` ignored) and the API logs a warning until it is set. Compose sets `1`. See the [proxy contract](#reverse-proxy-and-tls). |
| `PENDING_TRADE_TTL_MINUTES` | `30` | | A trade that was taken but never funded is cancelled automatically (`cancelReason: "expired"`) after this many minutes and its USDC goes back to the offer. `0` disables expiry. |
| `TRADE_EXPIRY_INTERVAL_SECONDS` | `60` | | How often each API process runs the expiry sweep (5–3600). Safe with several replicas. |
| `BODY_LIMIT` | `20kb` | | Max JSON body size (larger → 413). |
| `STATIC_DIR` | – (image: `/app/dist`) | | Serve the built SPA from the API (hashed assets cached 1 year, `index.html` `no-cache`, client-side routing fallback). |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | < orchestrator grace period | Max time to drain in-flight requests after `SIGTERM`. |
| `LOG_LEVEL` | `info` (`silent` in tests) | `info` | `fatal` … `trace`, `silent`. |
| `CSP_CONNECT_SRC` | – | | Extra origins for CSP `connect-src` (custom Horizon/RPC used by the browser). |
| `DATABASE_URL` | – | **required** (or `PG*`) | `postgres://user:pass@host:5432/db?sslmode=require`. No example passwords in production. |
| `PGHOST` `PGPORT` `PGUSER` `PGPASSWORD` `PGDATABASE` | libpq defaults | | Used when `DATABASE_URL` is empty. |
| `DB_POOL_MAX` | `10` | see [pooling](#pool-sizing) | Connections per API process. |
| `DB_STATEMENT_TIMEOUT_MS` | `10000` | | Server-side `statement_timeout`; idle-in-transaction timeout is 3×. `0` disables. |
| `DB_CONNECTION_TIMEOUT_MS` | `5000` | | Wait for a pool connection. |
| `DB_IDLE_TIMEOUT_MS` | `30000` | | Close idle pool connections. |
| `REDIS_URL` | – (memory) | **required** | `redis://:password@host:6379` (`rediss://` for TLS). If set and Redis is down, login/register and authenticated routes return 503 (fail-closed). |
| `ESCROW_CONTRACT_ID` | – | **required** | Deployed `luminary-escrow` contract (`C…`). |
| `VERIFY_STELLAR_TX` | `true` | must be `true` | `true` or `false` (any other value is a boot error). `false` only for local smoke tests with fake hashes; refused in production. |
| `SOROBAN_RPC_URL` | testnet SDF RPC | required on mainnet | Used to verify escrow transactions. |
| `STELLAR_NETWORK_PASSPHRASE` | Testnet | mainnet passphrase on mainnet | `Public Global Stellar Network ; September 2015`. |
| `USDC_ISSUER` | Circle **testnet** issuer | required on mainnet | Escrow token = the SAC of `USDC:<issuer>`. |
| `ESCROW_TOKEN_ID` | – | | Override the escrow token SAC (testing). |

Docker Compose additionally reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD`,
`API_PORT`, `LUMINARY_TAG`, `NO_NEW_PRIVILEGES` from `.env`. Frontend build variables (`VITE_*`) are
listed in [`.env.production.example`](../.env.production.example).

## Secrets management

- Secrets: `JWT_SECRET`, the PostgreSQL password, the Redis password. Nothing else in the app is secret
  (`VITE_*` values end up in public JavaScript; contract ids and issuers are public).
- Never commit `.env` (git-ignored, and excluded from the Docker build context). CI uses no secrets.
- Generate with `openssl rand -hex 48` (JWT) / `openssl rand -hex 24` (DB, Redis — hex keeps them URL-safe inside connection strings).
- Store them in the platform's secret store (Docker/Swarm secrets, Kubernetes Secrets with encryption at rest, AWS Secrets Manager / SSM, GCP Secret Manager, Doppler, 1Password…), inject as environment variables, and restrict who can read them.
- Rotation:
  - `JWT_SECRET`: rotate on suspicion of leak or periodically; all sessions become invalid (users log in again). There is no dual-key rotation yet.
  - DB/Redis passwords: create the new credential, roll the API, then revoke the old one.
- The logger redacts cookies, `Authorization`, passwords, hashes and tokens, never logs request bodies or query strings, and the Redis URL is logged with credentials masked.

## Running it

### Docker Compose (single host)

```bash
cp .env.example .env    # fill JWT_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD, PUBLIC_ORIGIN, NODE_ENV=production
docker compose up -d --build
docker compose ps       # postgres/redis/api healthy, migrate exited (0)
curl -fsS http://127.0.0.1:8080/api/health/ready
```

- `migrate` runs `server/db/migrate.js` and must finish successfully before `api` starts.
- The API port is published on `127.0.0.1` only: put the TLS proxy on the same host (or in the compose network).
- The `api` container runs as `node` (uid 1000) with a read-only filesystem, all capabilities dropped and `no-new-privileges`.
  Docker installed as a snap (AppArmor) cannot start containers with `no-new-privileges`; set `NO_NEW_PRIVILEGES=false` there.
- In `NODE_ENV=production` the CSP contains `upgrade-insecure-requests` and the cookie is `Secure`, so use the app in a browser through HTTPS. To poke at the stack over plain HTTP locally, run with `NODE_ENV=development`.
- Local smoke test against the stack: `NODE_ENV=development VERIFY_STELLAR_TX=false docker compose up -d api && API_URL=http://127.0.0.1:8080 npm run test:smoke`.

### Image only

```bash
docker build -t luminary-api:$(git rev-parse --short HEAD) .
docker run --rm --env-file .env -e NODE_ENV=production -p 127.0.0.1:8080:4000 luminary-api:<tag>
docker run --rm --env-file .env luminary-api:<tag> node server/db/migrate.js   # migrations
```

### Without Docker

Node ≥ 22.12, `npm ci --omit=dev` (after `npm ci && npm run build` on a build machine), then
`STATIC_DIR=dist node server/index.js` under a supervisor (systemd with `KillSignal=SIGTERM` and
`TimeoutStopSec` greater than `SHUTDOWN_TIMEOUT_MS`), or serve `dist/` from nginx and proxy `/api`.

## Reverse proxy and TLS

Terminate TLS at a reverse proxy (nginx, Caddy, Traefik, a cloud load balancer). Requirements:

- Redirect HTTP → HTTPS and send HSTS (the API also sends it in production).
- Pass `Host`, `X-Forwarded-For`, `X-Forwarded-Proto` and, ideally, `X-Request-Id` (the API reuses a safe incoming id and echoes it in the response, so proxy and API logs correlate).

### Proxy contract (`X-Forwarded-For` and `TRUST_PROXY`)

The per-IP login/register limits key on `req.ip`, which Express derives from `X-Forwarded-For` only for
the hops listed in `TRUST_PROXY`. Two rules, both required:

1. **The edge proxy must overwrite `X-Forwarded-For` with the address it sees**, never append to a
   client-supplied value. nginx: `proxy_set_header X-Forwarded-For $remote_addr;` (not
   `$proxy_add_x_forwarded_for`). Caddy, Traefik and cloud load balancers *append*: with them, trust exactly
   their hop count so that only the entry they appended is used.
2. **`TRUST_PROXY` = exactly the proxies in front of the API**, never more:
   - one reverse proxy (on the same host in front of the compose stack, or a single cloud load balancer) → `1` (compose default)
   - **Railway** (the platform's edge proxy is the only hop in front of the service) → `1`. Set it in the service variables: unset, every user shares the edge's IP. To check it after deploying, the request logs (`req.ip`) must show different client IPs, not the same internal address for everyone.
   - proxy on the same host talking to a bare `node server/index.js` on loopback → `loopback`
   - proxy container in the compose network → its IP or subnet, e.g. `172.18.0.0/16`
   - CDN → load balancer → API → `2`
   - no proxy (API directly exposed — not recommended) → `false`

If `TRUST_PROXY` is too permissive, a client can rotate `X-Forwarded-For` and get a fresh per-IP budget on
every request; if too strict, every user shares the proxy's IP and one abuser locks everybody out. The
production default is `false` (safe, but the second failure mode), so set it. In production with `TRUST_PROXY` unset, the API warns at boot and again, once per process, on the first request that carries `X-Forwarded-For` (proof that a proxy is in front). Independently of the proxy
setup, failed logins are also limited **per account** (lowercased email, 10 per 15 min, stored as a SHA-256
hash), so rotating IPs does not help brute-forcing one account. The API port must only be reachable through
the proxy (compose publishes it on `127.0.0.1` only); anyone who can reach it directly can choose the
`X-Forwarded-For` value the API trusts.
- Keep the proxy's upstream keep-alive timeout **below** the API's `keepAliveTimeout` (65 s).
- The API limits bodies to `BODY_LIMIT`; set the proxy limit similarly (`client_max_body_size 32k`).

nginx example:

```nginx
server {
  listen 443 ssl http2;
  server_name luminary.example.com;
  ssl_certificate     /etc/letsencrypt/live/luminary.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/luminary.example.com/privkey.pem;
  client_max_body_size 32k;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, never append the client's value
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-Id $request_id;
    proxy_read_timeout 35s;
  }
}
server { listen 80; server_name luminary.example.com; return 301 https://$host$request_uri; }
```

With this setup `PUBLIC_ORIGIN=https://luminary.example.com` and `TRUST_PROXY=1` (nginx → Docker's
published port: the API sees the Docker gateway as the peer, so `loopback` would not match).

## PostgreSQL

### Migrations

- Files: `server/db/migrations/NNN_name.sql`, applied in order, each in its own transaction together with its row in `schema_migrations (version, name, checksum, applied_at)`.
- `npm run db:migrate` applies pending ones; `npm run db:migrate -- --status` lists them. A Postgres advisory lock prevents two migrators from running at once.
- Applied files are immutable: a changed checksum aborts the run. Fix forward with a new migration.
- `001` and `002` are idempotent (they predate the tracking table), so databases created by older versions are baselined automatically on the first tracked run.
- Write migrations to be backwards compatible with the previous release (add columns/tables first, remove in a later release) so rolling deploys work.

### Pool sizing

Total connections = `DB_POOL_MAX` × API processes (+ migrations, + admin). Keep it under the server's
`max_connections` minus headroom; with many replicas put PgBouncer (transaction pooling) in front.
`statement_timeout` (default 10 s) kills runaway queries, and idle transactions are cut at 3× that.

### Backups and restore

What matters: `users`, `offers`, `trades` (trade state and escrow tx hashes). On-chain escrows are the
source of truth for funds; the DB maps them to users and trades, so losing it means manual reconciliation.

- **Managed Postgres** (RDS, Cloud SQL, Neon, Supabase…): enable automated backups with point-in-time recovery (≥ 7 days), plus a periodic logical dump to separate storage.
- **Self-hosted / compose**: nightly logical dumps, encrypted and shipped off-host, with retention (e.g. 7 daily, 4 weekly, 12 monthly):

  ```bash
  docker compose exec -T postgres pg_dump -U luminary -d luminary -Fc --no-owner \
    | gzip | age -r <recipient> > luminary-$(date +%F).dump.gz.age
  ```

  For RPO in minutes use WAL archiving / PITR (pgBackRest, WAL-G) instead of dumps alone.
- **Restore** (practise it; an untested backup is not a backup):

  ```bash
  docker compose stop api
  age -d -i key.txt luminary-2026-01-01.dump.gz.age | gunzip > restore.dump
  docker compose exec -T postgres dropdb -U luminary luminary
  docker compose exec -T postgres createdb -U luminary luminary
  docker compose exec -T postgres pg_restore -U luminary -d luminary --no-owner < restore.dump
  docker compose run --rm migrate          # applies anything newer than the backup
  docker compose start api
  ```

  Afterwards reconcile trades in `funded`/`paid` with the contract (`get_escrow`) for anything that happened after the backup.
- Never restore over production without stopping the API first, and keep the volume `pgdata` on durable storage.

## Redis

Stores only security state: login/register rate-limit counters (`luminary:rl:*`, per IP and per hashed
account email, TTL 15–60 min) and
revoked JWT ids (`luminary:revoked:jti:*`, TTL ≤ 7 days). Memory use is small (hundreds of bytes per key).

- **Persistence:** AOF with `appendfsync everysec` (+ RDB snapshots), as in `docker-compose.yml`. Without persistence a Redis restart silently un-revokes logged-out tokens until they expire.
- **Eviction:** `maxmemory-policy noeviction` (Redis default). An evicting policy could drop revocations.
- **Access:** password (`requirepass`/ACL), private network only, `rediss://` (TLS) when crossing hosts.
- **Availability:** the API fails closed: if Redis is configured but down, login/register and authenticated routes answer 503 and `/api/health/ready` is 503. Public reads keep working. Use a managed Redis with a replica, or Sentinel, if that downtime matters.
- Backups are optional (the data is short-lived); losing it only resets rate limits and revocations.

## Health checks, shutdown and scaling

| Endpoint | Meaning | Use for |
| --- | --- | --- |
| `GET /api/health/live` | Process answers; no dependency checks | liveness probe (restart only if this fails) |
| `GET /api/health/ready` | DB `SELECT 1` + cache ping OK and not shutting down; else 503 with `{db, cache, status}` | readiness probe, load balancer, uptime monitor, Docker `HEALTHCHECK` |
| `GET /api/health` | alias of `ready` | backwards compatibility |

On `SIGTERM`/`SIGINT` the API marks readiness as `503 shutting_down`, stops accepting connections,
lets in-flight requests finish (up to `SHUTDOWN_TIMEOUT_MS`, then closes the rest), closes the
PostgreSQL pool and the Redis client, and exits `0`. A second signal forces exit. Set the
orchestrator's grace period above `SHUTDOWN_TIMEOUT_MS` (compose: `stop_grace_period: 20s`).
HTTP timeouts: request 30 s, headers 15 s, keep-alive 65 s.

Scale horizontally behind the proxy; all replicas must share PostgreSQL and Redis (with
`REDIS_URL` unset each process would keep its own rate limits and revocations).

## Logging, monitoring and alerting

Logs are JSON lines on stdout (`level`, `time`, `service`, `env`, `reqId`, `req {method,url,ip}`,
`res {statusCode}`, `responseTime`). 4xx log at `warn`, 5xx at `error`; health probes are not logged.
500 responses include `requestId`, so a user report can be matched to the log line. Ship stdout to
Loki, ELK/OpenSearch, Datadog, CloudWatch… and keep 30–90 days.

Suggested alerts:

| Signal | Source | Alert when |
| --- | --- | --- |
| Readiness | uptime monitor on `/api/health/ready` | non-200 for > 2 min |
| 5xx rate | logs `res.statusCode >= 500` | > 1 % of requests over 5 min |
| Cache unavailable | log msg `cache unavailable → 503` | any, sustained 1 min |
| Soroban RPC errors | log msg `[escrow] Soroban RPC error` / 502 on `/trades/*` | > 5 in 5 min |
| Login abuse | 429 on `/api/auth/login` | spike vs baseline |
| Latency | `responseTime` p95 | > 1 s for 10 min |
| PostgreSQL | exporter / managed metrics | connections > 80 % of max, replication lag, disk > 80 %, backup job failed |
| Redis | exporter / managed metrics | memory > 80 %, AOF rewrite failures, evictions > 0 |
| Business | SQL on `trades` | trades in `funded`/`paid` older than the refund timeout; any `disputed` trade (manual handling needed) |
| Escrow contract | indexer / RPC events | contract balance ≠ Σ amounts of `funded`+`paid`+`disputed` trades |

Optional next steps: Prometheus metrics endpoint (`prom-client`), OpenTelemetry tracing, and a
browser error reporter (Sentry or similar) hooked into `ErrorBoundary`.

## Frontend build

- Build-time variables (`VITE_*`, see [`.env.production.example`](../.env.production.example)) are embedded in the public bundle: never put secrets there. In Docker pass them as `--build-arg`.
- `VITE_STELLAR_NETWORK=mainnet` requires `VITE_SOROBAN_RPC_URL` and `VITE_USDC_ISSUER` (the browser logs a config error otherwise) and hides Friendbot. The escrow contract and token ids always come from the API (`trade.escrow`), so the server config is the source of truth for funds.
- Routes are lazy-loaded; the Stellar SDK chunk (~630 kB, ~133 kB gzip) loads only on views that sign or read transactions. Initial load is ~222 kB JS (~73 kB gzip) vs 888 kB (215 kB gzip) before code-splitting. Hashed assets are served with `Cache-Control: immutable, max-age=1y`; `index.html` with `no-cache`.
- CSP (from helmet): `script-src 'self'`, no inline scripts in the build, `style-src 'self'` and `font-src 'self'` (fonts are self-hosted from `@fontsource/*` and bundled into `assets/`; no Google Fonts, so visitor IPs are not sent to a third party, and no inline styles: use Tailwind classes, not `style` attributes), `connect-src` limited to `'self'` + Horizon/Soroban/Friendbot (+ `CSP_CONNECT_SRC`). If you serve the SPA from nginx instead of the API, copy the CSP header from an API response.
- Error boundaries show a reload prompt when a chunk from a previous deploy is gone; keep the previous release's `assets/` available for a while during deploys if possible.
- No sourcemaps are emitted by default (`VITE_SOURCEMAP=true` to enable, e.g. for upload to an error tracker).

## Mainnet migration (escrow contract)

The testnet contracts (`CBWCY3KMNME5TKJTIRYNA3F32BJ6CG2UWIP7F6I6WYTK2HCAL23AWGKR`, and the previous `CA77HZ3YHCNKXG6M2OZKN7QAI7UDEEOX2AHDEQU5LO4DTD7QHI6K6BOI`) are for testing only.

1. **Audit.** Commission an independent audit of `contract-luminary/contracts/escrow` (auth on `create`/`release`/`refund`, timeout logic, token handling, storage TTL/archival and rent). Fix findings, tag the audited commit.
2. **Decide the open design points first** (see [Known limits](#known-limits)): refund timeout length, dispute/arbitration model, whether an admin/pausing mechanism is wanted. Changing them later means a new contract.
3. **Build reproducibly** from the audited tag: `cd contract-luminary && stellar contract build` (CI uploads the WASM as an artifact); record the WASM hash and compare it with the audited one.
4. **Deploy to mainnet** with a dedicated deployer account (hardware wallet or offline key, funded only with the XLM needed):
   ```bash
   stellar contract deploy --network mainnet --source <deployer> \
     --wasm target/wasm32v1-none/release/luminary_escrow.wasm
   ```
   Verify the deployed WASM hash on an explorer. The contract has no admin, so the deployer key holds no power afterwards.
5. **USDC.** Use Circle's mainnet USDC issuer. The value `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` was written from memory and is **unverified: verify it against Circle's official documentation before use** (a wrong issuer means a worthless or attacker-controlled token). Its Stellar Asset Contract id is derived automatically from `USDC_ISSUER` + network passphrase; check it matches the SAC listed on an explorer.
6. **Server env:** `STELLAR_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"`, `SOROBAN_RPC_URL=<mainnet RPC>` (SDF does not run a public mainnet RPC: use a provider or your own `stellar-rpc`), `USDC_ISSUER=<Circle mainnet issuer>`, `ESCROW_CONTRACT_ID=<new id>`, `VERIFY_STELLAR_TX=true`. The API refuses mainnet without explicit issuer and RPC.
7. **Frontend build:** `VITE_STELLAR_NETWORK=mainnet`, `VITE_SOROBAN_RPC_URL`, `VITE_HORIZON_URL` (if not `horizon.stellar.org`), `VITE_USDC_ISSUER`; add custom endpoints to `CSP_CONNECT_SRC`. Freighter must be on Mainnet (the app checks the passphrase).
8. **Data:** start mainnet with a fresh database, or close every testnet trade first — trades store the contract id they were funded with, and testnet hashes cannot be verified on mainnet.
9. **Dry run** with small real amounts end-to-end (fund → paid → release, fund → buyer refund, seller reclaim after timeout) before opening to users; adapt `npm run test:escrow-e2e` for mainnet if wanted (it currently targets testnet with Friendbot).
10. **Monitoring:** alert on contract balance vs DB (see table above) from day one.

## Known limits

- **Seller reclaim timeout.** After `refund_after_ledger` (~24 h of ledgers) the seller can reclaim the USDC on their own, **even if the buyer already paid fiat**. Buyers must pay promptly after `funded`; sellers must release promptly. The timeout is fixed in the contract.
- **No dispute resolution.** `disputed` is only a Luminary status; nobody can move escrowed funds except the parties per the contract rules. There is no arbiter, evidence flow or admin override.
- **Unregistered deposits.** If a seller funds the escrow on-chain but never registers the tx hash with the API (and the trade is cancelled), the funds sit in the contract until the seller reclaims after the timeout or the buyer refunds. The API does not scan the chain for orphaned escrows.
- **Pending-trade expiry.** A trade taken but not funded within `PENDING_TRADE_TTL_MINUTES` (30) is cancelled with `cancelReason: "expired"` and its USDC is returned to the offer, so throwaway accounts cannot park a competitor's liquidity. A sweep runs in every API process; a Postgres advisory lock plus a conditional `UPDATE … WHERE status = 'pending'` that restores liquidity only for the rows it changed make it safe with many replicas and against concurrent cancels or funding. With `VERIFY_STELLAR_TX=true` the sweep first checks `get_escrow` and skips trades that are already funded on-chain but not yet registered (and postpones expiry if the RPC is down). A seller who deposits in the last seconds before expiry can still race it; their USDC stays refundable via the contract. A per-user cap on open takes is not implemented.
- **Disputes and refunds.** In `disputed`, the API accepts a refund reported by the seller only if the on-chain `refund` was made by the seller at or after `refund_after_ledger` (or was made by the buyer). Without on-chain verification (dev only) it applies the same ~24 h rule from `funded_at`. This mirrors the contract; it is not an arbitration mechanism.
- **Account enumeration (audit M2, accepted).** `POST /api/auth/register` answers `409 "Ya existe una cuenta con ese email"` for a taken email. Kept for usability because there is no email-verification flow that would allow a generic answer. Registration is limited per IP and login per account. Linking a Stellar address that another account uses gets a generic `409` that does not confirm the linkage; the status code itself still differs from success until address ownership is proven (L2 below).
- **Per-account login limit.** 10 failed logins per account per 15 min, on top of 10 per IP. An attacker who knows an email can keep that account locked out of login (not out of existing sessions) for as long as they keep failing. This is the accepted price of not allowing distributed brute force.
- **Fiat is off-chain and unverified.** "paid" is the buyer's claim; there is no payment-provider integration.
- **Single JWT key, 7-day sessions**, no refresh tokens, no session list/"log out everywhere", no 2FA, no email verification or password reset.
- **Rate limiting** covers login/register only; other routes rely on the proxy for global limits.
- **No proof of Stellar address ownership (audit L2, follow-up).** A user can link any valid `G…` address. This mostly harms the claimant (USDC goes to the real key holder), but it lets someone squat an address so its real owner cannot link it. Planned fix: a signature challenge (sign a server nonce with the account key via Freighter `signMessage`/SEP-53) before linking, plus a reclaim path that overrides a squatter who cannot sign. Not implemented yet because it needs UX decisions (wallet support for message signing, migration of already-linked addresses, recovery flow).
- **Pre-escrow trades** (from before migration 002) can only be cancelled.
- **Frontend tests** cover logic, guards and key components; the trade and wallet views have no automated UI tests (manual/e2e testing required).

## Open blockers before a real-money launch

1. Contract audit and mainnet deployment (above) — requires human approval and funds.
2. Product/legal decisions: dispute handling, refund timeout, KYC/AML and licensing per fiat corridor, terms of service.
3. Infrastructure choice and provisioning (hosting, managed Postgres with PITR, managed Redis, TLS, log shipping, alerting) — none is configured by this repository.
4. Real secrets in a secret manager, and a restore drill of the backup procedure.
5. Address ownership proof (L2 above) before onboarding real users.
6. Load test of the trade endpoints and the bcrypt cost (12 rounds ≈ 250 ms CPU per login/register) on the target hardware.
