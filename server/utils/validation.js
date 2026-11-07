import { StrKey } from '@stellar/stellar-sdk';
import { badRequest } from './http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const TX_HASH_RE = /^[a-f0-9]{64}$/;

/**
 * Validador mínimo sin dependencias: acumula errores por campo y lanza 400
 * con `details` si hay alguno.
 */
export class Validator {
  constructor(body) {
    this.body = body && typeof body === 'object' ? body : {};
    this.errors = {};
    this.out = {};
  }

  #fail(field, msg) {
    this.errors[field] ??= msg;
  }

  #raw(field, { optional }) {
    const v = this.body[field];
    if (v === undefined || v === null || v === '') {
      if (!optional) this.#fail(field, 'Campo requerido');
      return undefined;
    }
    return v;
  }

  string(field, { min = 1, max = 255, optional = false, trim = true, pattern, patternMsg } = {}) {
    let v = this.#raw(field, { optional });
    if (v === undefined) return this;
    if (typeof v !== 'string') return (this.#fail(field, 'Debe ser texto'), this);
    if (trim) v = v.trim();
    if (v.length < min) return (this.#fail(field, `Mínimo ${min} caracteres`), this);
    if (v.length > max) return (this.#fail(field, `Máximo ${max} caracteres`), this);
    if (pattern && !pattern.test(v)) return (this.#fail(field, patternMsg ?? 'Formato inválido'), this);
    this.out[field] = v;
    return this;
  }

  email(field) {
    this.string(field, { max: 255, pattern: EMAIL_RE, patternMsg: 'Email inválido' });
    if (this.out[field]) this.out[field] = this.out[field].toLowerCase();
    return this;
  }

  /** `decimals`: máximo de decimales permitidos (coherente con la columna NUMERIC). */
  number(field, { min, max, exclusiveMin, decimals, integer = false, optional = false } = {}) {
    const v = this.#raw(field, { optional });
    if (v === undefined) return this;
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isFinite(n)) return (this.#fail(field, 'Debe ser un número'), this);
    if (integer && !Number.isSafeInteger(n)) return (this.#fail(field, 'Debe ser un entero'), this);
    if (decimals !== undefined && Math.abs(Math.round(n * 10 ** decimals) - n * 10 ** decimals) > 1e-6) {
      return (this.#fail(field, `Máximo ${decimals} decimales`), this);
    }
    if (exclusiveMin !== undefined && n <= exclusiveMin)
      return (this.#fail(field, `Debe ser mayor que ${exclusiveMin}`), this);
    if (min !== undefined && n < min) return (this.#fail(field, `Mínimo ${min}`), this);
    if (max !== undefined && n > max) return (this.#fail(field, `Máximo ${max}`), this);
    this.out[field] = n;
    return this;
  }

  oneOf(field, values, { optional = false } = {}) {
    const v = this.#raw(field, { optional });
    if (v === undefined) return this;
    if (!values.includes(v)) return (this.#fail(field, `Debe ser uno de: ${values.join(', ')}`), this);
    this.out[field] = v;
    return this;
  }

  currency(field, opts) {
    return this.string(field, {
      min: 3,
      max: 3,
      pattern: CURRENCY_RE,
      patternMsg: 'Código ISO 4217 (p.ej. COP)',
      ...opts,
    });
  }

  /** Dirección Stellar G…; `null` explícito se acepta para desvincular. */
  stellarAddress(field) {
    if (this.body[field] === null) {
      this.out[field] = null;
      return this;
    }
    this.string(field, { min: 56, max: 56, optional: true });
    const v = this.out[field];
    if (v !== undefined && !StrKey.isValidEd25519PublicKey(v)) {
      delete this.out[field];
      this.#fail(field, 'Dirección Stellar inválida');
    }
    return this;
  }

  txHash(field) {
    this.string(field, { min: 64, max: 64, pattern: TX_HASH_RE, patternMsg: 'Hash de transacción inválido' });
    return this;
  }

  check(cond, field, msg) {
    if (!cond) this.#fail(field, msg);
    return this;
  }

  /** Devuelve los valores validados o lanza 400. */
  done() {
    if (Object.keys(this.errors).length) throw badRequest('Datos inválidos', this.errors);
    return this.out;
  }
}

export const validate = (body) => new Validator(body);
