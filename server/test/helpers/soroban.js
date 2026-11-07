// Soroban RPC simulado para probar la verificación del escrow sin red.
// Construye transacciones y valores de contrato REALES (XDR) con el SDK, de modo que el
// código bajo prueba decodifica exactamente lo mismo que recibiría de un nodo RPC.
import { vi } from 'vitest';
import {
  Account,
  Address,
  Contract,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

const addr = (a) => new Address(a).toScVal();
const u64 = (n) => nativeToScVal(BigInt(n), { type: 'u64' });
const u32 = (n) => nativeToScVal(Number(n), { type: 'u32' });
const i128 = (n) => nativeToScVal(BigInt(n), { type: 'i128' });
const STATUS = { funded: 0, released: 1, refunded: 2 };

/** Envelope (base64) de una tx que invoca `fn(args)` en `contractId`. */
export function invocationEnvelope({ contractId, fn, args, source, passphrase = Networks.TESTNET }) {
  const tx = new TransactionBuilder(new Account(source, '1'), { fee: '100', networkPassphrase: passphrase })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(30)
    .build();
  return tx.toEnvelope().toXDR('base64');
}

/** Envelope de una tx sin invocación de contrato (operación clásica). */
export function classicEnvelope(source, passphrase = Networks.TESTNET) {
  const tx = new TransactionBuilder(new Account(source, '1'), { fee: '100', networkPassphrase: passphrase })
    .addOperation(Operation.bumpSequence({ bumpTo: '10' }))
    .setTimeout(30)
    .build();
  return tx.toEnvelope().toXDR('base64');
}

export const createArgs = ({ seller, buyer, token, amount, tradeId }) => [
  addr(seller),
  addr(buyer),
  addr(token),
  i128(amount),
  u64(tradeId),
];
export const releaseArgs = ({ seller, tradeId }) => [addr(seller), u64(tradeId)];
export const refundArgs = ({ caller, seller, tradeId }) => [addr(caller), addr(seller), u64(tradeId)];

/** ScVal del struct `Escrow` tal como lo devuelve `get_escrow` (mapa con claves ordenadas). */
export function escrowScVal({ seller, buyer, token, amount, refundAfterLedger = 1000, status = 'funded' }) {
  const entry = (key, val) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
  return xdr.ScVal.scvMap([
    entry('amount', i128(amount)),
    entry('buyer', addr(buyer)),
    entry('refund_after_ledger', u32(refundAfterLedger)),
    entry('seller', addr(seller)),
    entry('status', u32(STATUS[status])),
    entry('token', addr(token)),
  ]);
}

/**
 * Sustituye getTransaction/simulateTransaction de rpc.Server. `txs`: hash → respuesta;
 * `escrow`: ScVal | null (no existe) | Error (RPC caído) | función que lo devuelve.
 */
export function mockSorobanRpc({ txs = {}, escrow = null, getTxError } = {}) {
  const getTransaction = vi.spyOn(rpc.Server.prototype, 'getTransaction').mockImplementation(async (hash) => {
    if (getTxError) throw getTxError;
    return txs[hash] ?? { status: rpc.Api.GetTransactionStatus.NOT_FOUND };
  });
  const simulateTransaction = vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockImplementation(async () => {
    const value = typeof escrow === 'function' ? escrow() : escrow;
    if (value instanceof Error) throw value;
    if (value === null) return { error: 'HostError: Error(Contract, #2)' };
    if (typeof value === 'string') return { error: value };
    return { result: { retval: value }, latestLedger: 1 };
  });
  return { getTransaction, simulateTransaction };
}

/** Respuesta de getTransaction exitosa. */
export const successTx = (envelopeXdr, { createdAt = Math.floor(Date.now() / 1000), ledger = 500 } = {}) => ({
  status: rpc.Api.GetTransactionStatus.SUCCESS,
  envelopeXdr,
  createdAt,
  ledger,
});
