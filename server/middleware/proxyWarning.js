/**
 * Aviso (una sola vez por proceso) cuando llega `X-Forwarded-For` en producción sin TRUST_PROXY:
 * la API está detrás de un proxy (p.ej. Railway) pero ignora esa cabecera, así que `req.ip` es la
 * IP del proxy para TODOS los clientes y el rate limit por IP de login/registro los trata como
 * uno solo (un abusador bloquea a todos). El aviso de arranque no basta: no sabe si hay proxy.
 * @param {import('pino').Logger} logger
 */
export function forwardedForWarning(logger) {
  let warned = false;
  return (req, res, next) => {
    if (!warned && req.headers['x-forwarded-for'] !== undefined) {
      warned = true;
      logger.warn(
        { socketIp: req.socket.remoteAddress },
        'X-Forwarded-For recibido pero TRUST_PROXY no está definido: todas las peticiones parecen venir ' +
          'de la IP del proxy y el rate limit por IP las agrupa. Fija TRUST_PROXY (Railway o un único ' +
          'proxy inverso: TRUST_PROXY=1) — ver docs/PRODUCTION.md.'
      );
    }
    next();
  };
}
