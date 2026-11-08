import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TxCard from './TxCard.jsx';
import { EXPLORER_ACCOUNT_URL, EXPLORER_TX_URL } from '../../config/stellar.js';

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
});
