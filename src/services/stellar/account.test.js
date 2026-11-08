import { describe, expect, it } from 'vitest';
import { toPayment } from './account.js';

const ME = 'GME0000000000000000000000000000000000000000000000000000';
const OTHER = 'GOTHER00000000000000000000000000000000000000000000000000';

describe('toPayment', () => {
  it('maps an incoming USDC payment', () => {
    const p = toPayment(
      {
        id: '1',
        type: 'payment',
        transaction_hash: 'abc',
        from: OTHER,
        to: ME,
        amount: '12.5000000',
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        created_at: '2026-11-07T10:00:00Z',
      },
      ME
    );
    expect(p).toEqual({
      id: '1',
      hash: 'abc',
      kind: 'payment',
      amount: '12.5000000',
      asset: 'USDC',
      counterparty: OTHER,
      incoming: true,
      createdAt: '2026-11-07T10:00:00Z',
    });
  });

  it('maps an outgoing XLM payment to the recipient', () => {
    const p = toPayment({ id: '2', type: 'payment', from: ME, to: OTHER, amount: '3', asset_type: 'native' }, ME);
    expect(p.incoming).toBe(false);
    expect(p.counterparty).toBe(OTHER);
    expect(p.asset).toBe('XLM');
  });

  it('maps create_account using funder, account and starting balance', () => {
    const p = toPayment(
      { id: '3', type: 'create_account', funder: OTHER, account: ME, starting_balance: '10000.0000000' },
      ME
    );
    expect(p).toMatchObject({ incoming: true, counterparty: OTHER, amount: '10000.0000000', asset: 'XLM' });
  });
});
