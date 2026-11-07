import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import {
  ConfigError,
  assertServerConfig,
  estimateEntropyBits,
  jwtSecretProblems,
  loadConfig,
  looksLikePlaceholder,
  parseTrustProxy,
} from '../../config.js';

const STRONG = 'b7f1c2e9a04d58e3f6a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6b';
const CONTRACT = 'CA77HZ3YHCNKXG6M2OZKN7QAI7UDEEOX2AHDEQU5LO4DTD7QHI6K6BOI';

const prodEnv = (over = {}) => ({
  NODE_ENV: 'production',
  JWT_SECRET: STRONG,
  DATABASE_URL: 'postgres://luminary:Zx9-q7Lm2Rt@db:5432/luminary',
  REDIS_URL: 'redis://redis:6379',
  ESCROW_CONTRACT_ID: CONTRACT,
  PUBLIC_ORIGIN: 'https://luminary.example.org',
  ...over,
});

const serverProblems = (env) => loadConfig(env).serverProblems;

describe('JWT_SECRET validation', () => {
  it('accepts a long random secret', () => {
    expect(jwtSecretProblems(STRONG)).toEqual([]);
  });

  it('rejects missing, short, low-entropy and placeholder secrets', () => {
    expect(jwtSecretProblems('')).toEqual([expect.stringMatching(/Falta JWT_SECRET/)]);
    expect(jwtSecretProblems('abc123')).toContainEqual(expect.stringMatching(/al menos 32/));
    expect(jwtSecretProblems('a'.repeat(64))).toContainEqual(expect.stringMatching(/entropía/));
    expect(jwtSecretProblems('abababababababababababababababababab')).toContainEqual(expect.stringMatching(/entropía/));
    expect(jwtSecretProblems('replace-with-a-long-random-string-of-at-least-32-chars')).toContainEqual(
      expect.stringMatching(/valor de ejemplo/)
    );
  });

  it('estimates entropy from character frequencies', () => {
    expect(estimateEntropyBits('')).toBe(0);
    expect(estimateEntropyBits('aaaa')).toBe(0);
    expect(estimateEntropyBits('abcd')).toBeCloseTo(8);
    expect(estimateEntropyBits(STRONG)).toBeGreaterThan(200);
  });

  it('detects placeholders', () => {
    for (const v of [
      'change-me',
      'CHANGEME',
      'your_secret_here',
      'xxxxxxxx',
      'secret',
      'postgres://u:change-me@h/db',
    ]) {
      expect(looksLikePlaceholder(v), v).toBe(true);
    }
    expect(looksLikePlaceholder(STRONG)).toBe(false);
  });
});

describe('loadConfig', () => {
  it('uses development defaults', () => {
    const cfg = loadConfig({ JWT_SECRET: STRONG });
    expect(cfg).toMatchObject({
      env: 'development',
      isProd: false,
      host: '127.0.0.1',
      port: 4000,
      trustProxy: 'loopback',
      bodyLimit: '20kb',
      cookieSecure: false,
      db: { max: 10, statementTimeoutMs: 10_000 },
      stellar: { networkPassphrase: Networks.TESTNET, verifyTx: true, escrowContractId: null },
    });
    expect(cfg.stellar.escrowTokenId).toMatch(/^C[A-Z2-7]{55}$/);
    expect(cfg.serverProblems).toEqual([]);
  });

  it('collects format errors and throws them together', () => {
    let err;
    try {
      loadConfig({
        NODE_ENV: 'staging',
        PORT: 'abc',
        LOG_LEVEL: 'loud',
        ESCROW_CONTRACT_ID: 'nope',
        CORS_ORIGINS: 'ftp://x',
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.problems).toHaveLength(5);
  });

  it('parses integers within bounds', () => {
    expect(() => loadConfig({ DB_POOL_MAX: '0' })).toThrow(/DB_POOL_MAX/);
    expect(loadConfig({ DB_POOL_MAX: '25', SHUTDOWN_TIMEOUT_MS: '5000' })).toMatchObject({
      db: { max: 25 },
      shutdownTimeoutMs: 5000,
    });
  });

  it('normalises origins', () => {
    const cfg = loadConfig({
      CORS_ORIGINS: 'https://a.example.com, http://localhost:5173',
      PUBLIC_ORIGIN: 'https://app.example.com/',
    });
    expect(cfg.corsOrigins).toEqual(['https://a.example.com', 'http://localhost:5173']);
    expect(cfg.publicOrigin).toBe('https://app.example.com');
    expect(() => loadConfig({ CORS_ORIGINS: 'https://a.example.com/path' })).toThrow(/CORS_ORIGINS/);
  });

  it('requires an explicit USDC issuer and RPC on mainnet', () => {
    expect(() => loadConfig({ STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC })).toThrow(
      /USDC_ISSUER[\s\S]*SOROBAN_RPC_URL/
    );
    const cfg = loadConfig({
      STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC,
      USDC_ISSUER: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      SOROBAN_RPC_URL: 'https://rpc.example.org',
    });
    expect(cfg.stellar.escrowTokenId).toMatch(/^C/);
  });
});

describe('production requirements', () => {
  it('accepts a complete production environment', () => {
    const cfg = loadConfig(prodEnv());
    expect(cfg.serverProblems).toEqual([]);
    expect(cfg.cookieSecure).toBe(true);
    expect(() => assertServerConfig(cfg)).not.toThrow();
  });

  it.each([
    ['REDIS_URL', { REDIS_URL: '' }, /REDIS_URL/],
    ['ESCROW_CONTRACT_ID', { ESCROW_CONTRACT_ID: '' }, /ESCROW_CONTRACT_ID/],
    ['DATABASE_URL', { DATABASE_URL: '' }, /DATABASE_URL/],
    ['placeholder DB password', { DATABASE_URL: 'postgres://luminary:change-me@db/luminary' }, /contraseña de ejemplo/],
    ['placeholder PGPASSWORD', { DATABASE_URL: '', PGHOST: 'db', PGPASSWORD: 'changeme' }, /PGPASSWORD/],
    ['unverified escrow', { VERIFY_STELLAR_TX: 'false' }, /VERIFY_STELLAR_TX/],
    ['missing PUBLIC_ORIGIN', { PUBLIC_ORIGIN: '' }, /PUBLIC_ORIGIN/],
    ['http PUBLIC_ORIGIN', { PUBLIC_ORIGIN: 'http://luminary.example.org' }, /https/],
    ['weak JWT secret', { JWT_SECRET: 'short' }, /JWT_SECRET/],
  ])('refuses to serve without %s', (_name, over, re) => {
    const cfg = loadConfig(prodEnv(over));
    expect(cfg.serverProblems.join('\n')).toMatch(re);
    expect(() => assertServerConfig(cfg)).toThrow(ConfigError);
  });

  it('allows http://localhost as PUBLIC_ORIGIN for local production-mode runs', () => {
    expect(serverProblems(prodEnv({ PUBLIC_ORIGIN: 'http://localhost:8080' }))).toEqual([]);
  });

  it('does not require server secrets for CLI tools', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x@y/z' })).not.toThrow();
  });
});

describe('placeholders shipped in the repository (audit L3)', () => {
  /** Valor de `NAME=` en un archivo .env de ejemplo del repositorio. */
  const exampleValue = (file, name) => {
    const line = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  };

  it('refuses the exact JWT_SECRET from .env.example, in every environment', () => {
    const placeholder = exampleValue('.env.example', 'JWT_SECRET');
    expect(placeholder).toBeTruthy();
    expect(jwtSecretProblems(placeholder).length).toBeGreaterThan(0);
    expect(serverProblems({ JWT_SECRET: placeholder }).join('\n')).toMatch(/JWT_SECRET/);
    expect(serverProblems(prodEnv({ JWT_SECRET: placeholder })).join('\n')).toMatch(/JWT_SECRET/);
  });

  it('refuses the .env.example database password in production', () => {
    const url = exampleValue('.env.example', 'DATABASE_URL');
    expect(serverProblems(prodEnv({ DATABASE_URL: url })).join('\n')).toMatch(/contraseña de ejemplo/);
  });

  it('refuses previously documented placeholder secrets', () => {
    for (const v of [
      'replace-with-a-long-random-string-of-at-least-32-chars',
      'replace-with-the-output-of-openssl-rand-hex-48',
      'CHANGE_ME',
    ]) {
      expect(jwtSecretProblems(v).length, v).toBeGreaterThan(0);
    }
  });

  it('refuses production without REDIS_URL and with VERIFY_STELLAR_TX=false in any spelling', () => {
    expect(serverProblems(prodEnv({ REDIS_URL: undefined })).join('\n')).toMatch(/REDIS_URL/);
    for (const v of ['false', 'FALSE', ' False ']) {
      expect(serverProblems(prodEnv({ VERIFY_STELLAR_TX: v })).join('\n'), v).toMatch(/VERIFY_STELLAR_TX/);
    }
    // Valores ambiguos no se interpretan: error de configuración.
    expect(() => loadConfig(prodEnv({ VERIFY_STELLAR_TX: '0' }))).toThrow(/VERIFY_STELLAR_TX/);
  });
});

describe('parseTrustProxy', () => {
  it.each([
    [undefined, 'loopback'],
    ['', 'loopback'],
    ['false', false],
    ['0', false],
    ['1', 1],
    ['2', 2],
    ['loopback, 10.0.0.0/8', ['loopback', '10.0.0.0/8']],
    ['uniquelocal', ['uniquelocal']],
    ['172.18.0.1', ['172.18.0.1']],
    ['fd00::/8, 192.168.1.10', ['fd00::/8', '192.168.1.10']],
  ])('%s → %j', (raw, value) => {
    expect(parseTrustProxy(raw)).toEqual({ value });
  });

  it('does not trust any proxy by default in production', () => {
    expect(parseTrustProxy(undefined, { isProd: true })).toEqual({ value: false });
    expect(parseTrustProxy('  ', { isProd: true })).toEqual({ value: false });
    expect(parseTrustProxy('1', { isProd: true })).toEqual({ value: 1 });
    expect(loadConfig(prodEnv())).toMatchObject({ trustProxy: false, trustProxyExplicit: false });
    expect(loadConfig(prodEnv({ TRUST_PROXY: '1' }))).toMatchObject({ trustProxy: 1, trustProxyExplicit: true });
  });

  it('rejects trusting every proxy', () => {
    expect(parseTrustProxy('true').error).toMatch(/TRUST_PROXY=true/);
  });

  it.each(['yes', '11', '-1', '10.0.0.0/33', '300.1.1.1', 'loopback,foo', 'fd00::/129', '1.2.3.4/8/1', ','])(
    'rejects %j',
    (raw) => {
      expect(parseTrustProxy(raw).error).toMatch(/TRUST_PROXY/);
      expect(() => loadConfig({ TRUST_PROXY: raw })).toThrow(ConfigError);
    }
  );
});

describe('trade timers', () => {
  it('defaults to a 30 min pending TTL swept every minute', () => {
    expect(loadConfig({}).trades).toMatchObject({ pendingTtlMs: 30 * 60_000, expiryIntervalMs: 60_000 });
  });

  it('accepts overrides and 0 to disable expiry', () => {
    expect(loadConfig({ PENDING_TRADE_TTL_MINUTES: '0' }).trades.pendingTtlMs).toBe(0);
    expect(loadConfig({ PENDING_TRADE_TTL_MINUTES: '5', TRADE_EXPIRY_INTERVAL_SECONDS: '10' }).trades).toMatchObject({
      pendingTtlMs: 5 * 60_000,
      expiryIntervalMs: 10_000,
    });
    expect(() => loadConfig({ PENDING_TRADE_TTL_MINUTES: '-1' })).toThrow(/PENDING_TRADE_TTL_MINUTES/);
    expect(() => loadConfig({ TRADE_EXPIRY_INTERVAL_SECONDS: '1' })).toThrow(/TRADE_EXPIRY_INTERVAL_SECONDS/);
  });
});
