/** Error HTTP con código de estado y detalles opcionales por campo. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'No autenticado') => new HttpError(401, msg);
export const forbidden = (msg = 'No autorizado') => new HttpError(403, msg);
export const notFound = (msg = 'No encontrado') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

/** Parsea un id numérico de la ruta o lanza 404. */
export function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound();
  return id;
}
