import { api, qs } from './client.js';

export const listTrades = (status) => api.get(`/trades${qs({ status })}`).then((r) => r.trades);
export const getTrade = (id) => api.get(`/trades/${id}`).then((r) => r.trade);
/** Toma una oferta: abre un trade por `usdcAmount` USDC. */
export const openTrade = (offerId, usdcAmount) => api.post('/trades', { offerId, usdcAmount }).then((r) => r.trade);
export const markPaid = (id) => api.post(`/trades/${id}/paid`).then((r) => r.trade);
export const releaseTrade = (id, txHash) => api.post(`/trades/${id}/release`, { txHash }).then((r) => r.trade);
export const cancelTrade = (id) => api.post(`/trades/${id}/cancel`).then((r) => r.trade);
export const disputeTrade = (id) => api.post(`/trades/${id}/dispute`).then((r) => r.trade);
