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
 * Parámetros del escrow on-chain (contrato luminary-escrow) de una operación.
 * @typedef {Object} TradeEscrow
 * @property {string|null} contractId   Contrato de escrow (C…); null si el servidor no lo tiene configurado
 * @property {string} tokenId           SAC del USDC (C…)
 * @property {string} tradeId           u64 del contrato (= id de la operación)
 * @property {string} amountStroops     i128 exacto (7 decimales)
 * @property {string|null} fundTxHash   Hash de la tx `create`
 * @property {string|null} seller       Dirección con la que se creó el escrow
 * @property {string|null} buyer
 * @property {number|null} refundAfterLedger Ledger desde el que el vendedor puede reclamar
 */

/**
 * Operación P2P. Flujo: pending → funded (USDC en escrow) → paid → released
 * (o cancelled / refunded / disputed).
 * @typedef {Object} Trade
 * @property {number} id
 * @property {number} offerId
 * @property {'pending'|'funded'|'paid'|'released'|'refunded'|'cancelled'|'disputed'} status
 * @property {number} usdcAmount
 * @property {number} price
 * @property {string} currency
 * @property {number} fiatAmount
 * @property {string|null} stellarTxHash  Tx que cerró el escrow (release o refund)
 * @property {TradeEscrow} escrow
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
 * Pago reciente de una cuenta, normalizado desde Horizon (ver services/stellar/account.js).
 * @typedef {Object} RecentPayment
 * @property {string} id
 * @property {string} hash           hash de la transacción
 * @property {string} kind           tipo de operación de Horizon (payment, create_account…)
 * @property {string} [contractFn]   método invocado si kind = 'invoke_host_function' (create, release, refund…)
 * @property {string|null} amount    null si una invocación de contrato no movió activos de la cuenta
 * @property {string|null} asset     'XLM' o código del activo (p. ej. 'USDC')
 * @property {string|null} counterparty  la otra cuenta (G…) o contrato (C…) del pago
 * @property {boolean} incoming      true si la cuenta recibió el pago
 * @property {string} createdAt      ISO 8601
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
