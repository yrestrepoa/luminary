import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { validate } from '../../utils/validation.js';
import { HttpError, badRequest, conflict, forbidden, notFound, parseId, unauthorized } from '../../utils/http.js';

const errorsOf = (fn) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
    return err.details;
  }
  throw new Error('expected a validation error');
};

describe('Validator', () => {
  it('returns trimmed, typed values', () => {
    const out = validate({ name: '  Ana ', n: '12.50', t: 'buy' })
      .string('name', { min: 2 })
      .number('n', { decimals: 2 })
      .oneOf('t', ['buy', 'sell'])
      .done();
    expect(out).toEqual({ name: 'Ana', n: 12.5, t: 'buy' });
  });

  it('accumulates one error per field', () => {
    const details = errorsOf(() => validate({ a: 5, b: 'x' }).string('a').string('b', { min: 3 }).string('c').done());
    expect(details).toEqual({ a: 'Debe ser texto', b: 'Mínimo 3 caracteres', c: 'Campo requerido' });
  });

  it('treats a non-object body as empty', () => {
    expect(errorsOf(() => validate('nope').string('x').done())).toEqual({ x: 'Campo requerido' });
    expect(validate(null).string('x', { optional: true }).done()).toEqual({});
  });

  it('lower-cases and checks emails', () => {
    expect(validate({ e: ' Ana@Example.COM ' }).email('e').done()).toEqual({ e: 'ana@example.com' });
    expect(errorsOf(() => validate({ e: 'ana@' }).email('e').done())).toEqual({ e: 'Email inválido' });
  });

  it('validates numbers: finiteness, integer, decimals and bounds', () => {
    const d = errorsOf(() =>
      validate({ a: 'abc', b: 1.5, c: 1.123, d: 0, e: 11, f: Infinity })
        .number('a')
        .number('b', { integer: true })
        .number('c', { decimals: 2 })
        .number('d', { exclusiveMin: 0 })
        .number('e', { max: 10 })
        .number('f')
        .done()
    );
    expect(d).toEqual({
      a: 'Debe ser un número',
      b: 'Debe ser un entero',
      c: 'Máximo 2 decimales',
      d: 'Debe ser mayor que 0',
      e: 'Máximo 10',
      f: 'Debe ser un número',
    });
    expect(validate({ x: 0.1234567 }).number('x', { decimals: 7 }).done()).toEqual({ x: 0.1234567 });
  });

  it('rejects SQL-looking currency codes', () => {
    expect(errorsOf(() => validate({ c: "COP' OR 1=1--" }).currency('c').done()).c).toMatch(/Máximo 3|ISO/);
    expect(validate({ c: 'COP' }).currency('c').done()).toEqual({ c: 'COP' });
  });

  it('accepts valid Stellar addresses and explicit null', () => {
    const pk = Keypair.random().publicKey();
    expect(validate({ s: pk }).stellarAddress('s').done()).toEqual({ s: pk });
    expect(validate({ s: null }).stellarAddress('s').done()).toEqual({ s: null });
    expect(validate({}).stellarAddress('s').done()).toEqual({});
    const bad = 'G' + 'A'.repeat(55);
    expect(errorsOf(() => validate({ s: bad }).stellarAddress('s').done())).toEqual({
      s: 'Dirección Stellar inválida',
    });
  });

  it('validates transaction hashes', () => {
    expect(
      validate({ h: 'a'.repeat(64) })
        .txHash('h')
        .done()
    ).toEqual({ h: 'a'.repeat(64) });
    expect(
      errorsOf(() =>
        validate({ h: 'Z'.repeat(64) })
          .txHash('h')
          .done()
      ).h
    ).toBe('Hash de transacción inválido');
  });

  it('supports custom checks', () => {
    expect(errorsOf(() => validate({}).check(false, 'x', 'bad').done())).toEqual({ x: 'bad' });
  });
});

describe('http helpers', () => {
  it('builds typed errors', () => {
    expect(badRequest('m', { a: 'b' })).toMatchObject({ status: 400, message: 'm', details: { a: 'b' } });
    expect(unauthorized().status).toBe(401);
    expect(forbidden().status).toBe(403);
    expect(notFound().status).toBe(404);
    expect(conflict('c').status).toBe(409);
  });

  it('parses positive safe integer ids or throws 404', () => {
    expect(parseId('42')).toBe(42);
    for (const bad of ['0', '-1', '1.5', 'abc', '9007199254740993']) {
      expect(() => parseId(bad), bad).toThrow(expect.objectContaining({ status: 404 }));
    }
  });
});
