/**
 * Tipos compartidos (JSDoc). Este módulo no exporta valores en runtime;
 * se referencia en anotaciones JSDoc vía `import('<ruta>/types/index.js').Nombre`.
 */

/**
 * Oferta P2P. type 'sell' = el comerciante vende USDC (el usuario compra).
 * @typedef {Object} Offer
 * Las ofertas de la API traen userId/status/createdAt; `rating` es null hasta tener reputación.
 * @property {number} id
 * @property {'sell'|'buy'} type
 * @property {string} merchant
 * @property {number|null} rating
 * @property {number} trades
 * @property {number} price
 * @property {string} currency
 * @property {number} available
 * @property {number|null} min
 * @property {number|null} max
 * @property {string} paymentMethod
 * @property {string} bank
 * @property {number} [userId]
 * @property {'active'|'paused'|'closed'} [status]
 * @property {string} [createdAt]
 * @property {boolean} [demo] true si viene de los datos de demostración
 */

/**
 * Usuario autenticado (nunca incluye el hash de contraseña).
 * @typedef {Object} User
 * @property {number} id
 * @property {string} email
 * @property {string} displayName
 * @property {string|null} stellarAddress
 * @property {string} createdAt
 */

/**
 * Parte de una operación.
 * @typedef {Object} TradeParty
 * @property {number} id
 * @property {string} displayName
 * @property {string|null} stellarAddress
 */

/**
 * Operación P2P. Flujo: pending → paid → released (o cancelled / disputed).
 * @typedef {Object} Trade
 * @property {number} id
 * @property {number} offerId
 * @property {'pending'|'paid'|'released'|'cancelled'|'disputed'} status
 * @property {number} usdcAmount
 * @property {number} price
 * @property {string} currency
 * @property {number} fiatAmount
 * @property {string|null} stellarTxHash
 * @property {string} paymentMethod
 * @property {string} bank
 * @property {TradeParty} buyer
 * @property {TradeParty} seller
 * @property {string} createdAt
 * @property {string} updatedAt
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
