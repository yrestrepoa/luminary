// Lista de JWT revocados (por `jti`), con TTL = vida restante del token: al expirar el
// token, la entrada desaparece sola. Con Redis la revocación vale para todos los procesos;
// sin Redis solo para el proceso actual (se avisa al arrancar, ver server/cache/index.js).
import { cache as defaultCache } from './index.js';

const key = (jti) => `revoked:jti:${jti}`;

export function createRevocationList(cache = defaultCache) {
  return {
    /** Revoca `jti` hasta `expSeconds` (claim `exp` del JWT). No hace nada si ya expiró. */
    async revoke(jti, expSeconds) {
      const ttlMs = expSeconds * 1000 - Date.now();
      if (!jti || ttlMs <= 0) return;
      await cache.set(key(jti), '1', ttlMs);
    },
    /** true si el token fue revocado. Lanza CacheUnavailableError si Redis no responde. */
    isRevoked: (jti) => cache.exists(key(jti)),
  };
}

export const revocations = createRevocationList();
