/**
 * Cliente HTTP mínimo para la API de Luminary (/api, proxied por Vite en desarrollo).
 * La sesión viaja en una cookie httpOnly: el frontend nunca ve el JWT.
 */

export class ApiError extends Error {
  /** @param {number} status @param {string} message @param {Record<string,string>} [details] */
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = null;
/** Registra un callback para respuestas 401 (sesión expirada o inválida). */
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

const BASE = '/api';

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor');
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? `Error ${res.status}`, data?.details);
  }
  return data;
}

/** Construye un query string ignorando valores vacíos. */
export const qs = (params = {}) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all')
  ).toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
};
