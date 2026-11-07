// Configuración de la API leída de variables de entorno y validada al arrancar (fail fast).
//
// loadConfig() es pura (recibe el entorno) para poder probarla; `config` es la instancia
// usada por la app. Si algo es inválido se lanza ConfigError con TODOS los problemas a la vez.
import { isIP } from 'node:net';
import dotenv from 'dotenv';
import { Asset, Networks, StrKey } from '@stellar/stellar-sdk';

// En tests el entorno lo fija la suite; .env (si existe) solo se carga fuera de NODE_ENV=test.
if (process.env.NODE_ENV !== 'test') dotenv.config({ quiet: true });

export const NODE_ENVS = ['development', 'test', 'production'];
export const DEFAULT_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'; // Circle, testnet
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

// Valores de ejemplo/plantilla que nunca deben llegar a un despliegue.
const PLACEHOLDER_RE =
  /replace[-_ ]?with|change[-_ ]?me|changeme|placeholder|your[-_ ]?secret|example|^(secret|password)$|x{6,}/i;
export const MIN_JWT_SECRET_LENGTH = 32;
export const MIN_JWT_SECRET_BITS = 128;

export class ConfigError extends Error {
  constructor(problems) {
    super(`Configuración inválida:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** Entropía estimada (bits) de `s` según la frecuencia de sus caracteres (Shannon × longitud). */
export function estimateEntropyBits(s) {
  if (!s) return 0;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let perChar = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    perChar -= p * Math.log2(p);
  }
  return perChar * s.length;
}

export const looksLikePlaceholder = (value) => PLACEHOLDER_RE.test(value);

/** Problemas de un JWT_SECRET (vacío = válido). */
export function jwtSecretProblems(secret) {
  if (!secret) return ['Falta JWT_SECRET (genera uno: openssl rand -hex 48)'];
  const out = [];
  if (secret.length < MIN_JWT_SECRET_LENGTH)
    out.push(`JWT_SECRET debe tener al menos ${MIN_JWT_SECRET_LENGTH} caracteres`);
  if (looksLikePlaceholder(secret)) out.push('JWT_SECRET parece un valor de ejemplo; genera uno aleatorio');
  else if (estimateEntropyBits(secret) < MIN_JWT_SECRET_BITS) {
    out.push(`JWT_SECRET tiene muy poca entropía (< ${MIN_JWT_SECRET_BITS} bits); usa: openssl rand -hex 48`);
  }
  return out;
}

const TRUST_PROXY_NAMED = ['loopback', 'linklocal', 'uniquelocal'];
export const MAX_TRUST_PROXY_HOPS = 10;

/** true si `s` es una IP (v4/v6) o una subred CIDR válida. */
function isIpOrCidr(s) {
  const [ip, prefix, ...rest] = s.split('/');
  const family = isIP(ip);
  if (!family || rest.length) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * TRUST_PROXY → valor de `app.set('trust proxy')`, validado. Acepta:
 *  - `false` / `0`: no confiar en X-Forwarded-For (req.ip = IP del socket);
 *  - número de saltos (1…10): proxies delante de la API (p.ej. `1` = un proxy inverso);
 *  - lista separada por comas de IPs, subredes CIDR o 'loopback' | 'linklocal' | 'uniquelocal'.
 * 'true' (confiar en cualquiera) y valores no reconocidos se rechazan: permitirían falsear
 * X-Forwarded-For y saltarse el rate limit por IP.
 * Por defecto: `false` en producción (hay que declarar el proxy explícitamente) y 'loopback' en desarrollo.
 */
export function parseTrustProxy(raw, { isProd = false } = {}) {
  const v = (raw ?? '').trim();
  if (v === '') return { value: isProd ? false : 'loopback' };
  if (v === 'false' || v === '0') return { value: false };
  if (v === 'true') {
    return { error: 'TRUST_PROXY=true confía en cualquier X-Forwarded-For (rate limit evitable); indica saltos o IPs' };
  }
  if (/^\d+$/.test(v)) {
    const hops = Number(v);
    if (hops > MAX_TRUST_PROXY_HOPS)
      return { error: `TRUST_PROXY: como mucho ${MAX_TRUST_PROXY_HOPS} saltos de proxy` };
    return { value: hops };
  }
  const items = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const invalid = items.filter((s) => !TRUST_PROXY_NAMED.includes(s) && !isIpOrCidr(s));
  if (!items.length || invalid.length) {
    return {
      error: `TRUST_PROXY: valor no válido (${invalid.join(', ') || v}); usa false, un número de saltos, IPs/CIDR o ${TRUST_PROXY_NAMED.join(' | ')}`,
    };
  }
  return { value: items };
}

/** Lista de orígenes `scheme://host[:port]` separada por comas. */
function parseOrigins(raw, name, problems) {
  const out = [];
  for (const item of (raw ?? '').split(',').map((s) => s.trim())) {
    if (!item) continue;
    try {
      const u = new URL(item);
      if (!['http:', 'https:'].includes(u.protocol) || u.origin !== item.replace(/\/$/, '')) throw new Error();
      out.push(u.origin);
    } catch {
      problems.push(`${name}: "${item}" no es un origen válido (p.ej. https://app.example.com)`);
    }
  }
  return out;
}

function int(env, name, def, { min, max }, problems) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} debe ser un entero entre ${min} y ${max}`);
    return def;
  }
  return n;
}

function contractId(env, name, problems) {
  const value = env[name];
  if (!value) return null;
  if (!StrKey.isValidContract(value)) {
    problems.push(`${name} no es un id de contrato Stellar válido (C…)`);
    return null;
  }
  return value;
}

/** Lee y valida la configuración. Lanza ConfigError con todos los problemas encontrados. */
export function loadConfig(env = process.env) {
  const problems = []; // errores de formato: invalidan cualquier uso (API, migraciones, scripts)
  const serverProblems = []; // requisitos para servir tráfico (secretos, producción): assertServerConfig()
  const nodeEnv = env.NODE_ENV || 'development';
  if (!NODE_ENVS.includes(nodeEnv)) problems.push(`NODE_ENV debe ser uno de: ${NODE_ENVS.join(', ')}`);
  const isProd = nodeEnv === 'production';

  const jwtSecret = env.JWT_SECRET ?? '';
  serverProblems.push(...jwtSecretProblems(jwtSecret));

  const logLevel = env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info');
  if (!LOG_LEVELS.includes(logLevel)) problems.push(`LOG_LEVEL debe ser uno de: ${LOG_LEVELS.join(', ')}`);

  const trustProxy = parseTrustProxy(env.TRUST_PROXY, { isProd });
  if (trustProxy.error) problems.push(trustProxy.error);

  const databaseUrl = env.DATABASE_URL || undefined;
  const redisUrl = env.REDIS_URL || undefined;
  const verifyRaw = (env.VERIFY_STELLAR_TX || 'true').trim().toLowerCase();
  if (!['true', 'false'].includes(verifyRaw)) problems.push('VERIFY_STELLAR_TX debe ser true o false');
  const verifyTx = verifyRaw !== 'false';
  const escrowContractId = contractId(env, 'ESCROW_CONTRACT_ID', problems);
  const escrowTokenOverride = contractId(env, 'ESCROW_TOKEN_ID', problems);
  const usdcIssuer = env.USDC_ISSUER || DEFAULT_USDC_ISSUER;
  if (!StrKey.isValidEd25519PublicKey(usdcIssuer)) problems.push('USDC_ISSUER no es una cuenta Stellar válida (G…)');
  const networkPassphrase = env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

  if (networkPassphrase === Networks.PUBLIC) {
    // Mainnet: los valores por defecto (USDC y RPC de testnet) serían incorrectos.
    if (!env.USDC_ISSUER && !escrowTokenOverride) {
      problems.push('Mainnet: define USDC_ISSUER (emisor de USDC de mainnet) o ESCROW_TOKEN_ID');
    }
    if (!env.SOROBAN_RPC_URL) problems.push('Mainnet: define SOROBAN_RPC_URL (el valor por defecto es de testnet)');
  }

  const publicOrigin = parseOrigins(env.PUBLIC_ORIGIN, 'PUBLIC_ORIGIN', problems)[0];
  const corsOrigins = parseOrigins(env.CORS_ORIGINS, 'CORS_ORIGINS', problems);
  const cspConnectSrc = parseOrigins(env.CSP_CONNECT_SRC, 'CSP_CONNECT_SRC', problems);

  if (isProd) {
    // En producción nada de valores por defecto "de desarrollo".
    if (!databaseUrl && !env.PGHOST) serverProblems.push('Producción: define DATABASE_URL (o PGHOST/PGUSER/…)');
    if (databaseUrl && looksLikePlaceholder(databaseUrl)) {
      serverProblems.push('Producción: DATABASE_URL contiene una contraseña de ejemplo');
    }
    if (env.PGPASSWORD && looksLikePlaceholder(env.PGPASSWORD)) {
      serverProblems.push('Producción: PGPASSWORD es un valor de ejemplo');
    }
    if (!redisUrl)
      serverProblems.push('Producción: define REDIS_URL (rate limit y revocación compartidos entre procesos)');
    if (!verifyTx)
      serverProblems.push('Producción: VERIFY_STELLAR_TX=false no está permitido (verificación on-chain obligatoria)');
    if (!escrowContractId) serverProblems.push('Producción: define ESCROW_CONTRACT_ID');
    if (!publicOrigin) serverProblems.push('Producción: define PUBLIC_ORIGIN (URL pública https:// de la app)');
    else if (!publicOrigin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(publicOrigin)) {
      serverProblems.push('Producción: PUBLIC_ORIGIN debe ser https:// (las cookies de sesión son Secure)');
    }
  }

  const cfg = {
    env: nodeEnv,
    isProd,
    isTest: nodeEnv === 'test',
    host: env.HOST || '127.0.0.1',
    port: int(env, 'PORT', 4000, { min: 0, max: 65535 }, problems),
    logLevel,
    trustProxy: trustProxy.value,
    trustProxyExplicit: Boolean(env.TRUST_PROXY?.trim()),
    // Origen público de la SPA (p.ej. https://luminary.example). Las peticiones con Origin
    // distinto del propio host, PUBLIC_ORIGIN o CORS_ORIGINS se rechazan en métodos mutantes.
    publicOrigin: publicOrigin ?? null,
    corsOrigins,
    // Orígenes extra para connect-src de la CSP (Horizon/RPC propios si la SPA usa otros).
    cspConnectSrc,
    bodyLimit: env.BODY_LIMIT || '20kb',
    // Carpeta del build de Vite (dist/) para servir la SPA desde la API. Vacío = solo API.
    staticDir: env.STATIC_DIR || null,
    shutdownTimeoutMs: int(env, 'SHUTDOWN_TIMEOUT_MS', 10_000, { min: 0, max: 120_000 }, problems),
    // DATABASE_URL tiene prioridad; si no está, `pg` usa PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
    databaseUrl,
    db: {
      max: int(env, 'DB_POOL_MAX', 10, { min: 1, max: 200 }, problems),
      idleTimeoutMs: int(env, 'DB_IDLE_TIMEOUT_MS', 30_000, { min: 0, max: 3_600_000 }, problems),
      connectionTimeoutMs: int(env, 'DB_CONNECTION_TIMEOUT_MS', 5_000, { min: 0, max: 60_000 }, problems),
      statementTimeoutMs: int(env, 'DB_STATEMENT_TIMEOUT_MS', 10_000, { min: 0, max: 600_000 }, problems),
    },
    // Redis para rate limit y revocación de tokens. Vacío → memoria del proceso (solo desarrollo).
    redisUrl,
    jwt: {
      secret: jwtSecret,
      expiresIn: '7d',
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    },
    cookieName: 'luminary_token',
    trades: {
      // Trades `pending` (tomados pero nunca fondeados) se cancelan solos tras este tiempo y
      // devuelven el USDC reservado a la oferta (evita bloquear liquidez ajena). 0 = desactivado.
      pendingTtlMs: int(env, 'PENDING_TRADE_TTL_MINUTES', 30, { min: 0, max: 7 * 24 * 60 }, problems) * 60_000,
      // Cada cuánto corre el barrido de expiración en cada proceso de la API.
      expiryIntervalMs: int(env, 'TRADE_EXPIRY_INTERVAL_SECONDS', 60, { min: 5, max: 3600 }, problems) * 1000,
      // Plazo tras el depósito a partir del cual el VENDEDOR puede reembolsarse (contrato:
      // REFUND_TIMEOUT_LEDGERS = 17 280 ledgers ≈ 24 h). Solo se usa sin verificación on-chain;
      // con VERIFY_STELLAR_TX=true manda el ledger real de la tx de refund.
      sellerRefundAfterMs: 17_280 * 5_000,
    },
    // Cookies Secure en producción (requiere HTTPS delante; localhost es contexto seguro).
    cookieSecure: isProd,
    stellar: {
      networkPassphrase,
      rpcUrl: env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
      usdcIssuer,
      // Contrato luminary-escrow desplegado (contract-luminary/contracts/escrow). Sin él no se puede fondear.
      escrowContractId,
      // Token del escrow: el SAC de USDC por defecto; ESCROW_TOKEN_ID permite otro SAC (pruebas).
      escrowTokenId:
        escrowTokenOverride ??
        (StrKey.isValidEd25519PublicKey(usdcIssuer)
          ? new Asset('USDC', usdcIssuer).contractId(networkPassphrase)
          : null),
      // Verifica on-chain (Soroban RPC) el escrow antes de cambiar el estado de un trade.
      // false solo para pruebas locales sin red (npm run test:smoke usa hashes ficticios).
      verifyTx,
    },
  };

  if (problems.length) throw new ConfigError(problems);
  cfg.serverProblems = serverProblems;
  return cfg;
}

/**
 * Requisitos para arrancar la API (JWT_SECRET fuerte, y en producción: Redis, escrow
 * verificado, PUBLIC_ORIGIN https, sin contraseñas de ejemplo). Las herramientas de línea de
 * comandos (migraciones, scripts) no los necesitan y solo usan loadConfig().
 */
export function assertServerConfig(cfg = config) {
  if (cfg.serverProblems.length) throw new ConfigError(cfg.serverProblems);
}

/** Configuración de la app (validada al importar: un error aquí detiene el arranque). */
export const config = loadConfig();
