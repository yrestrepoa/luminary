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

  describe('invoke_host_function (escrow)', () => {
    const ESCROW = 'CA77HZ3YHCNKXG6M2OZKN7QAI7UDEEOX2AHDEQU5LO4DTD7QHI6K6BOI';
    // `parameters` tal como los devuelve Horizon: ScVal en XDR base64 (dirección del contrato + método).
    const SYM_XDR = { create: 'AAAADwAAAAZjcmVhdGUAAA==', release: 'AAAADwAAAAdyZWxlYXNlAA==' };
    const sym = (s) => ({ type: 'Sym', value: SYM_XDR[s] });
    const contractAddr = { type: 'Address', value: 'AAAAEgAAAAE/8+d4OJqrm8zTsqb+AEfoMhHX0A4yQp1buDmP8Do8rw==' };
    const usdc = { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GISSUER', type: 'transfer' };
    const invoke = (fn, changes) => ({
      id: '4',
      type: 'invoke_host_function',
      transaction_hash: 'def',
      function: 'HostFunctionTypeHostFunctionTypeInvokeContract',
      parameters: [contractAddr, sym(fn)],
      asset_balance_changes: changes,
      created_at: '2026-11-07T11:00:00Z',
    });

    it('derives an outgoing USDC deposit from asset_balance_changes', () => {
      const p = toPayment(invoke('create', [{ ...usdc, from: ME, to: ESCROW, amount: '20.0000000' }]), ME);
      expect(p).toEqual({
        id: '4',
        hash: 'def',
        kind: 'invoke_host_function',
        contractFn: 'create',
        amount: '20.0000000',
        asset: 'USDC',
        counterparty: ESCROW,
        incoming: false,
        createdAt: '2026-11-07T11:00:00Z',
      });
    });

    it('picks the change that involves the account (release to the buyer)', () => {
      const changes = [
        { ...usdc, from: OTHER, to: ESCROW, amount: '1' },
        { ...usdc, from: ESCROW, to: ME, amount: '20.0000000' },
      ];
      const p = toPayment(invoke('release', changes), ME);
      expect(p).toMatchObject({ contractFn: 'release', incoming: true, amount: '20.0000000', counterparty: ESCROW });
    });

    it('falls back to no amount when the account has no balance change', () => {
      const p = toPayment(invoke('release', undefined), ME);
      expect(p).toMatchObject({ contractFn: 'release', amount: null, asset: null, counterparty: null });
    });

    it('tolerates missing or undecodable parameters', () => {
      const p = toPayment({ ...invoke('x', []), parameters: [contractAddr, { type: 'Sym', value: '!!' }] }, ME);
      expect(p.contractFn).toBeNull();
      expect(toPayment({ ...invoke('x', []), parameters: undefined }, ME).contractFn).toBeNull();
    });
  });
});
