/**
 * Tipos compartidos (JSDoc). Este módulo no exporta valores en runtime;
 * se referencia en anotaciones JSDoc vía `import('<ruta>/types/index.js').Nombre`.
 */

/**
 * Oferta P2P. type 'sell' = el comerciante vende USDC (el usuario compra).
 * @typedef {Object} Offer
 * @property {number} id
 * @property {'sell'|'buy'} type
 * @property {string} merchant
 * @property {number} rating
 * @property {number} trades
 * @property {number} price
 * @property {string} currency
 * @property {number} available
 * @property {number} min
 * @property {number} max
 * @property {string} paymentMethod
 * @property {string} bank
 */

/**
 * Balance de una cuenta Stellar.
 * @typedef {Object} AccountBalance
 * @property {boolean} funded
 * @property {string} xlm
 * @property {string|null} usdc
 * @property {boolean} hasTrustline
 */

/**
 * Firmante de transacciones.
 * @typedef {Object} Signer
 * @property {string} publicKey
 * @property {(xdr: string) => Promise<string>} sign
 */

/**
 * Aviso mostrado al usuario.
 * @typedef {Object} Notice
 * @property {'ok'|'err'} kind
 * @property {string} text
 * @property {string} [href]
 */

export {};
