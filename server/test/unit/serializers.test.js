import { describe, expect, it } from 'vitest';
import { toStroops } from '../../utils/stellar.js';
import { toOffer, toTrade, toUser } from '../../utils/serializers.js';
import { config } from '../../config.js';

describe('toStroops', () => {
  it.each([
    ['12.5', 125_000_000n],
    ['0.0000001', 1n],
    ['100', 1_000_000_000n],
    ['10.5000000', 105_000_000n],
    [7, 70_000_000n],
  ])('%s → %s', (input, expected) => {
    expect(toStroops(input)).toBe(expected);
  });

  it('truncates beyond 7 decimals instead of rounding through floats', () => {
    expect(toStroops('0.12345678')).toBe(1_234_567n);
  });
});

describe('serializers', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('never exposes the password hash', () => {
    const user = toUser({
      id: 1,
      email: 'a@b.co',
      display_name: 'A',
      stellar_address: null,
      created_at: now,
      password_hash: 'x',
    });
    expect(user).toEqual({ id: 1, email: 'a@b.co', displayName: 'A', stellarAddress: null, createdAt: now });
  });

  it('maps offer rows (NUMERIC strings → numbers)', () => {
    const offer = toOffer({
      id: 3,
      user_id: 1,
      type: 'sell',
      merchant: 'Ana',
      completed_trades: 2,
      fiat_price: '4100.5000',
      fiat_currency: 'COP',
      usdc_amount: '89.5000000',
      min_fiat: null,
      max_fiat: '1000000.00',
      payment_method: 'Nequi',
      bank: '',
      status: 'active',
      created_at: now,
    });
    expect(offer).toMatchObject({ price: 4100.5, available: 89.5, min: null, max: 1_000_000, trades: 2, rating: null });
  });

  it('maps trade rows with exact escrow parameters', () => {
    const t = toTrade({
      id: 9,
      offer_id: 3,
      status: 'funded',
      usdc_amount: '10.5000000',
      fiat_price: '4100.5000',
      fiat_currency: 'COP',
      fiat_amount: '43055.25',
      stellar_tx_hash: null,
      escrow_contract_id: null,
      escrow_tx_hash: 'f'.repeat(64),
      escrow_seller: 'GS',
      escrow_buyer: 'GB',
      escrow_refund_after_ledger: 1234,
      payment_method: 'Nequi',
      bank: 'X',
      buyer_id: 2,
      buyer_name: 'Bob',
      buyer_address: 'GB',
      seller_id: 1,
      seller_name: 'Ana',
      seller_address: 'GS',
      created_at: now,
      updated_at: now,
    });
    expect(t.escrow).toEqual({
      contractId: config.stellar.escrowContractId,
      tokenId: config.stellar.escrowTokenId,
      tradeId: '9',
      amountStroops: '105000000',
      fundTxHash: 'f'.repeat(64),
      seller: 'GS',
      buyer: 'GB',
      refundAfterLedger: 1234,
    });
    expect(t).toMatchObject({ usdcAmount: 10.5, fiatAmount: 43055.25, buyer: { id: 2 }, seller: { id: 1 } });
    expect(t).toMatchObject({ expiresAt: null, cancelReason: null, fundedAt: null });
  });

  it('exposes the pending expiry and the cancel reason', () => {
    const base = { id: 1, usdc_amount: '1', created_at: now, updated_at: now };
    const pending = toTrade({ ...base, status: 'pending' });
    expect(pending.expiresAt).toEqual(new Date(now.getTime() + config.trades.pendingTtlMs));
    const expired = toTrade({ ...base, status: 'cancelled', cancel_reason: 'expired' });
    expect(expired).toMatchObject({ expiresAt: null, cancelReason: 'expired' });
  });
});
