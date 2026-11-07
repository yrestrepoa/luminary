// Store de express-rate-limit sobre server/cache: con Redis los contadores se comparten
// entre todos los procesos de la API; sin Redis se usa la memoria del proceso.
// Si Redis está configurado pero caído, increment() lanza CacheUnavailableError y la
// petición termina en 503 (fail-closed: no se deja pasar tráfico sin limitar).
import { cache as defaultCache } from './index.js';

export class CacheRateLimitStore {
  /** `prefix` distingue limitadores (p.ej. 'rl:login:'); cada limitador necesita su propio store. */
  constructor(prefix, cache = defaultCache) {
    this.prefix = prefix;
    this.cache = cache;
    this.localKeys = false; // los contadores viven fuera del proceso (o así se tratan)
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const { count, ttlMs } = await this.cache.incr(this.prefix + key, this.windowMs);
    return { totalHits: count, resetTime: new Date(Date.now() + ttlMs) };
  }

  async decrement(key) {
    await this.cache.decr(this.prefix + key);
  }

  async resetKey(key) {
    await this.cache.del(this.prefix + key);
  }
}
