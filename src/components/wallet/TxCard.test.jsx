import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TxCard from './TxCard.jsx';
import { EXPLORER_ACCOUNT_URL, EXPLORER_CONTRACT_URL, EXPLORER_TX_URL } from '../../config/stellar.js';

const OTHER = 'GOTHERABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNWXYZ';
const base = {
  id: '1',
  hash: 'deadbeef',
  kind: 'payment',
  asset: 'USDC',
  counterparty: OTHER,
  createdAt: '2026-11-07T10:00:00Z',
};

const renderTx = (tx) =>
  render(
    <ul>
      <TxCard tx={tx} />
    </ul>
  );

describe('TxCard', () => {
  it('shows an incoming payment with its sign and explorer links', () => {
    renderTx({ ...base, amount: '12.5', incoming: true });
    expect(screen.getByText(/Pago de/)).toBeInTheDocument();
    expect(screen.getByText(/\+12,5/)).toHaveTextContent('Recibido');
    expect(screen.getByRole('link', { name: 'GOTH…WXYZ' })).toHaveAttribute('href', EXPLORER_ACCOUNT_URL + OTHER);
    expect(screen.getByRole('link', { name: /Ver transacción/ })).toHaveAttribute('href', EXPLORER_TX_URL + 'deadbeef');
  });

  it('shows an outgoing payment with a minus sign', () => {
    renderTx({ ...base, amount: '3', asset: 'XLM', incoming: false });
    expect(screen.getByText(/Pago a/)).toBeInTheDocument();
    expect(screen.getByText(/−3 XLM/)).toHaveTextContent('Enviado');
  });

  it('falls back to the raw operation type', () => {
    renderTx({ ...base, kind: 'clawback', amount: '1', incoming: false });
    expect(screen.getByText(/clawback a/)).toBeInTheDocument();
  });

  describe('Soroban contract calls', () => {
    const ESCROW = 'CA77HZ3YHCNKXG6M2OZKN7QAI7UDEEOX2AHDEQU5LO4DTD7QHI6K6BOI';
    const call = { ...base, kind: 'invoke_host_function', counterparty: ESCROW };

    it('labels an escrow deposit with its amount and links to the contract', () => {
      renderTx({ ...call, contractFn: 'create', amount: '20', incoming: false });
      expect(screen.getByText(/Depósito en escrow/)).toBeInTheDocument();
      expect(screen.getByText(/−20 USDC/)).toHaveTextContent('Enviado');
      expect(screen.getByRole('link', { name: 'CA77…6BOI' })).toHaveAttribute('href', EXPLORER_CONTRACT_URL + ESCROW);
      expect(screen.queryByText(/invoke_host_function/)).not.toBeInTheDocument();
    });

    it('labels release and refund', () => {
      const { unmount } = renderTx({ ...call, contractFn: 'release', amount: '20', incoming: true });
      expect(screen.getByText(/Liberación de USDC/)).toBeInTheDocument();
      expect(screen.getByText(/\+20 USDC/)).toBeInTheDocument();
      unmount();
      renderTx({ ...call, contractFn: 'refund', amount: '20', incoming: true });
      expect(screen.getByText(/Reembolso de escrow/)).toBeInTheDocument();
    });

    it('uses a generic label and no amount when nothing can be derived', () => {
      renderTx({ ...call, contractFn: null, amount: null, asset: null, counterparty: null, incoming: false });
      const title = screen.getByText('Operación de contrato');
      expect(title.textContent).toBe('Operación de contrato');
      expect(screen.queryByText(/Enviado/)).not.toBeInTheDocument();
    });
  });
});
