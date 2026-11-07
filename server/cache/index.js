// Almacén clave/valor con TTL: Redis si REDIS_URL está definido, memoria del proceso si no.
//
// Ideas tomadas de boots/managers/CacheManager.ts (prefijo de claves, timeout de conexión
// y de cada operación, mapa en memoria con barrido periódico y tope de entradas), pero con
// otra política ante fallos: aquí NO se cae silenciosamente a memoria cuando Redis está
// configurado y deja de responder. El almacén guarda datos de seguridad (contadores del
// rate limit, lista de tokens revocados); degradarlos a memoria por proceso abriría huecos
// (límites por proceso, revocaciones que otro proceso no ve). En su lugar cada operación
// lanza CacheUnavailableError → la API responde 503 (fail-closed).
import { createClient } from 'redis';
import { config } from '../config.js';

const KEY_PREFIX = 'luminary:';
const CONNECT_TIMEOUT_MS = 2_000;
const OP_TIMEOUT_MS = 1_000;
const MEMORY_SWEEP_MS = 60_000;
const MEMORY_MAX_ENTRIES = 50_000;

/** Redis configurado pero inaccesible (o lento): las rutas que dependen de él responden 503. */
export class CacheUnavailableError extends Error {
  constructor(cause) {
    super('Almacén de sesiones no disponible');
    this.name = 'CacheUnavailableError';
    this.status = 503;
    this.cause = cause;
  }
}

// INCR + PEXPIRE atómicos; repara claves sin TTL. Devuelve [contador, ttl restante ms].
const INCR_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
local t = redis.call('PTTL', KEYS[1])
if c == 1 or t < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  t = tonumber(ARGV[1])
end
return {c, t}`;

// DECR sin bajar de 0 (lo usa express-rate-limit con skipSuccessfulRequests).
const DECR_SCRIPT = `
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
if c > 0 then return redis.call('DECR', KEYS[1]) end
return 0`;

// --------------------------------------------------------------------------- memoria

class MemoryBackend {
  kind = 'memory';
  #map = new Map(); // key → { value, expires }

  constructor() {
    this.timer = setInterval(() => this.#sweep(), MEMORY_SWEEP_MS);
    this.timer.unref();
  }

  #sweep() {
    const now = Date.now();
    for (const [k, e] of this.#map) if (e.expires <= now) this.#map.delete(k);
    // Tope duro: descarta las más antiguas (orden de inserción).
    for (const k of this.#map.keys()) {
      if (this.#map.size <= MEMORY_MAX_ENTRIES) break;
      this.#map.delete(k);
    }
  }

  #live(key) {
    const e = this.#map.get(key);
    if (!e) return null;
    if (e.expires <= Date.now()) {
      this.#map.delete(key);
      return null;
    }
    return e;
  }

  async get(key) {
    return this.#live(key)?.value ?? null;
  }

  async set(key, value, ttlMs) {
    this.#map.set(key, { value: String(value), expires: Date.now() + ttlMs });
  }

  async del(key) {
    this.#map.delete(key);
  }

  async exists(key) {
    return this.#live(key) !== null;
  }

  async incr(key, ttlMs) {
    const e = this.#live(key);
    if (!e) {
      this.#map.set(key, { value: '1', expires: Date.now() + ttlMs });
      return { count: 1, ttlMs };
    }
    e.value = String(Number(e.value) + 1);
    return { count: Number(e.value), ttlMs: e.expires - Date.now() };
  }

  async decr(key) {
    const e = this.#live(key);
    if (e && Number(e.value) > 0) e.value = String(Number(e.value) - 1);
  }

  async ping() {
    return true;
  }

  async close() {
    clearInterval(this.timer);
    this.#map.clear();
  }
}

// --------------------------------------------------------------------------- Redis

class RedisBackend {
  kind = 'redis';
  #lastErrorLog = 0;

  constructor(url) {
    this.client = createClient({
      url,
      // Sin cola offline: si no hay conexión, los comandos fallan al instante (no se acumulan).
      disableOfflineQueue: true,
      socket: {
        connectTimeout: CONNECT_TIMEOUT_MS,
        // Reintenta siempre con backoff (máx. 5 s): la API se recupera sola cuando vuelve Redis.
        reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, 5_000),
      },
    });
    this.client.on('error', (err) => {
      // Una línea cada 30 s como mucho, para no inundar el log mientras Redis está caído.
      if (Date.now() - this.#lastErrorLog > 30_000) {
        this.#lastErrorLog = Date.now();
        console.error(`[cache] Redis error: ${err.message}`);
      }
    });
    this.client.on('ready', () => console.log('[cache] Redis conectado'));
  }

  /** Conecta con timeout. Si falla, el cliente sigue reintentando en segundo plano. */
  async connect() {
    const pending = this.client.connect();
    pending.catch(() => {}); // el resultado se gestiona abajo / por los reintentos
    let timer;
    try {
      await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout al conectar')), CONNECT_TIMEOUT_MS);
        }),
      ]);
      return true;
    } catch (err) {
      console.error(`[cache] No se pudo conectar a Redis (${err.message}); se reintentará. Rutas de sesión/login → 503 hasta entonces.`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async #cmd(args) {
    if (!this.client.isReady) throw new CacheUnavailableError(new Error('Redis no conectado'));
    let timer;
    try {
      return await Promise.race([
        this.client.sendCommand(args),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timeout de ${OP_TIMEOUT_MS} ms`)), OP_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      throw err instanceof CacheUnavailableError ? err : new CacheUnavailableError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  async get(key) {
    return this.#cmd(['GET', key]);
  }

  async set(key, value, ttlMs) {
    await this.#cmd(['SET', key, String(value), 'PX', String(Math.max(1, Math.ceil(ttlMs)))]);
  }

  async del(key) {
    await this.#cmd(['DEL', key]);
  }

  async exists(key) {
    return Number(await this.#cmd(['EXISTS', key])) === 1;
  }

  async incr(key, ttlMs) {
    const [count, ttl] = await this.#cmd(['EVAL', INCR_SCRIPT, '1', key, String(Math.ceil(ttlMs))]);
    return { count: Number(count), ttlMs: Number(ttl) };
  }

  async decr(key) {
    await this.#cmd(['EVAL', DECR_SCRIPT, '1', key]);
  }

  async ping() {
    try {
      return (await this.#cmd(['PING'])) === 'PONG';
    } catch {
      return false;
    }
  }

  async close() {
    try {
      if (this.client.isOpen) await this.client.close();
      else this.client.destroy();
    } catch {
      /* ya cerrado */
    }
  }
}

// --------------------------------------------------------------------------- fachada

/**
 * Crea el almacén. Todas las claves llevan el prefijo `luminary:`.
 * API: get / set(ttlMs) / del / exists / incr(ttlMs) → {count, ttlMs} / decr / ping / close.
 */
export function createCache(url = config.redisUrl) {
  const backend = url ? new RedisBackend(url) : new MemoryBackend();
  const k = (key) => KEY_PREFIX + key;
  return {
    get kind() {
      return backend.kind;
    },
    async init() {
      if (backend.kind === 'redis') {
        console.log(`[cache] Usando Redis (${redactUrl(url)})`);
        await backend.connect();
      } else {
        console.warn(
          '[cache] REDIS_URL no definido: rate limit y revocación de tokens en MEMORIA del proceso ' +
            '(no se comparten entre procesos ni sobreviven a reinicios). Usa Redis en producción.'
        );
      }
    },
    get: (key) => backend.get(k(key)),
    set: (key, value, ttlMs) => backend.set(k(key), value, ttlMs),
    del: (key) => backend.del(k(key)),
    exists: (key) => backend.exists(k(key)),
    incr: (key, ttlMs) => backend.incr(k(key), ttlMs),
    decr: (key) => backend.decr(k(key)),
    ping: () => backend.ping(),
    close: () => backend.close(),
  };
}

/** Oculta credenciales de la URL para el log. */
function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return '(URL inválida)';
  }
}

/** Instancia compartida por la app. */
export const cache = createCache();
