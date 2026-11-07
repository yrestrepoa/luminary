/** Ofertas de demostración (hasta que exista un backend de ofertas). */
/** @type {import('../types/index.js').Offer[]} */
export const MOCK_OFFERS = [
  { id: 1, type: 'sell', merchant: 'CambiosAndes', rating: 4.9, trades: 1284, price: 4120.5, currency: 'COP', available: 2500, min: 50000, max: 5000000, paymentMethod: 'Transferencia', bank: 'Bancolombia' },
  { id: 2, type: 'sell', merchant: 'NequiPro', rating: 4.7, trades: 532, price: 4135, currency: 'COP', available: 800, min: 20000, max: 2000000, paymentMethod: 'Billetera móvil', bank: 'Nequi' },
  { id: 3, type: 'buy', merchant: 'DaviTrader', rating: 4.8, trades: 911, price: 4085.25, currency: 'COP', available: 4000, min: 100000, max: 10000000, paymentMethod: 'Transferencia', bank: 'Davivienda' },
  { id: 4, type: 'sell', merchant: 'AztecaFX', rating: 4.6, trades: 302, price: 18.42, currency: 'MXN', available: 1500, min: 200, max: 30000, paymentMethod: 'SPEI', bank: 'BBVA México' },
  { id: 5, type: 'buy', merchant: 'PampaCoin', rating: 4.5, trades: 188, price: 1185, currency: 'ARS', available: 600, min: 10000, max: 700000, paymentMethod: 'CBU / Alias', bank: 'Banco Galicia' },
  { id: 6, type: 'buy', merchant: 'LimaSwap', rating: 4.9, trades: 740, price: 3.74, currency: 'PEN', available: 1200, min: 50, max: 15000, paymentMethod: 'Yape', bank: 'BCP' },
];
