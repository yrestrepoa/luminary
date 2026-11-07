import { api, qs } from './client.js';

/** Ofertas activas del mercado. filters: { type?, currency?, limit? } */
export const listOffers = (filters) => api.get(`/offers${qs(filters)}`).then((r) => r.offers);
export const listMyOffers = () => api.get('/offers/mine').then((r) => r.offers);
export const getOffer = (id) => api.get(`/offers/${id}`).then((r) => r.offer);
export const createOffer = (data) => api.post('/offers', data).then((r) => r.offer);
/** data: { status?, price?, usdcAmount?, min?, max?, paymentMethod?, bank? } */
export const updateOffer = (id, data) => api.patch(`/offers/${id}`, data).then((r) => r.offer);
export const closeOffer = (id) => api.delete(`/offers/${id}`);
