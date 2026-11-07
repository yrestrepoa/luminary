/**
 * Convierte filas SQL (snake_case) a objetos de la API (camelCase).
 * `pg` devuelve NUMERIC como string: aquí se pasa a number para el frontend
 * (precisión de double suficiente para mostrar montos; los cálculos críticos
 * de saldo se hacen en SQL).
 */

import { config } from '../config.js';
import { toStroops } from './stellar.js';

const num = (v) => (v === null || v === undefined ? null : Number(v));

export const toUser = (r) => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  stellarAddress: r.stellar_address ?? null,
  createdAt: r.created_at,
});

/** Compatible con el tipo `Offer` del frontend (src/types/index.js). */
export const toOffer = (r) => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  merchant: r.merchant ?? null,
  rating: null,
  trades: r.completed_trades ?? 0,
  price: num(r.fiat_price),
  currency: r.fiat_currency,
  available: num(r.usdc_amount),
  min: num(r.min_fiat),
  max: num(r.max_fiat),
  paymentMethod: r.payment_method,
  bank: r.bank,
  status: r.status,
  createdAt: r.created_at,
});

export const toTrade = (r) => ({
  id: r.id,
  offerId: r.offer_id,
  status: r.status,
  usdcAmount: num(r.usdc_amount),
  price: num(r.fiat_price),
  currency: r.fiat_currency,
  fiatAmount: num(r.fiat_amount),
  // Hash de la tx que cerró el escrow (release o refund).
  stellarTxHash: r.stellar_tx_hash ?? null,
  // Datos para construir/consultar el escrow on-chain desde el frontend.
  escrow: {
    contractId: r.escrow_contract_id ?? config.stellar.escrowContractId,
    tokenId: config.stellar.escrowTokenId,
    tradeId: String(r.id), // u64 del contrato
    amountStroops: toStroops(r.usdc_amount).toString(), // i128 exacto (7 decimales)
    fundTxHash: r.escrow_tx_hash ?? null,
    seller: r.escrow_seller ?? null,
    buyer: r.escrow_buyer ?? null,
    refundAfterLedger: r.escrow_refund_after_ledger ?? null,
  },
  paymentMethod: r.payment_method,
  bank: r.bank,
  buyer: { id: r.buyer_id, displayName: r.buyer_name, stellarAddress: r.buyer_address ?? null },
  seller: { id: r.seller_id, displayName: r.seller_name, stellarAddress: r.seller_address ?? null },
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
