import { describe, expect, it } from 'vitest';
import { fmtDate, fmtFiat, fmtNumber, shortenAddress, toStellarAmount } from './format.js';

// Intl puede usar espacios no separables; se normalizan para comparar.
const norm = (s) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('format utils', () => {
  it('formats fiat amounts in es-CO', () => {
    expect(norm(fmtFiat(43055.25, 'COP'))).toBe('$ 43.055,25');
    expect(norm(fmtFiat(10, 'USD'))).toMatch(/US\$ 10|USD 10|10/);
  });

  it('formats numbers with a maximum of decimals', () => {
    expect(fmtNumber(1234.56789)).toBe('1.234,57');
    expect(fmtNumber('0.1234567', 7)).toBe('0,1234567');
  });

  it('shortens Stellar addresses', () => {
    const a = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
    expect(shortenAddress(a)).toBe('GABC…TUVW');
    expect(shortenAddress(a, 6)).toBe('GABCDE…RSTUVW');
  });

  it('converts to the 7-decimal amount string Stellar expects', () => {
    expect(toStellarAmount(10)).toBe('10');
    expect(toStellarAmount(10.5)).toBe('10.5');
    expect(toStellarAmount(0.1 + 0.2)).toBe('0.3');
    expect(toStellarAmount(0.0000001)).toBe('0.0000001');
  });

  it('formats dates', () => {
    expect(fmtDate('2026-01-15T15:30:00Z')).toMatch(/2026/);
  });
});
