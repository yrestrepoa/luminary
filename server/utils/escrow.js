// Verificación on-chain del escrow (contrato luminary-escrow) vía Soroban RPC.
//
// El estado del contrato es la fuente de verdad: para cada transición se comprueba
// (1) que el hash informado es una transacción exitosa que invoca la función esperada
//     de NUESTRO contrato para este (seller, trade_id), y
// (2) que el estado actual del escrow (get_escrow) coincide con lo esperado.
import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { HttpError, badRequest } from './http.js';
import { toStroops } from './stellar.js';

export const ESCROW_STATUS = ['funded', 'released', 'refunded']; // índice = enum Status del contrato
const CONTRACT_ERROR_NOT_FOUND = 2;
// Margen para relojes: una tx no puede ser (mucho) anterior a la creación del trade.
const CLOCK_SKEW_S = 120;

let server;
function rpcServer() {
  const url = config.stellar.rpcUrl;
  server ??= new rpc.Server(url, { allowHttp: url.startsWith('http://') });
  return server;
}

const unavailable = (err) => {
  logger.error({ err }, '[escrow] Soroban RPC error');
  return new HttpError(502, 'No se pudo consultar Soroban RPC; intenta de nuevo');
};

/**
 * Lee el escrow `(seller, tradeId)` simulando `get_escrow` (sin firmar ni pagar fee).
 * @returns {Promise<null | { seller, buyer, token, amount: bigint, refundAfterLedger: number, status: string }>}
 */
export async function readEscrow({ contractId, seller, tradeId }) {
  const tx = new TransactionBuilder(new Account(seller, '0'), {
    fee: '100',
    networkPassphrase: config.stellar.networkPassphrase,
  })
    .addOperation(
      new Contract(contractId).call(
        'get_escrow',
        new Address(seller).toScVal(),
        nativeToScVal(BigInt(tradeId), { type: 'u64' })
      )
    )
    .setTimeout(30)
    .build();

  let sim;
  try {
    sim = await rpcServer().simulateTransaction(tx);
  } catch (err) {
    throw unavailable(err);
  }
  if (rpc.Api.isSimulationError(sim)) {
    if (sim.error.includes(`Error(Contract, #${CONTRACT_ERROR_NOT_FOUND})`)) return null;
    throw unavailable(new Error(sim.error));
  }
  const v = scValToNative(sim.result.retval);
  return {
    seller: v.seller,
    buyer: v.buyer,
    token: v.token,
    amount: BigInt(v.amount),
    refundAfterLedger: Number(v.refund_after_ledger),
    status: ESCROW_STATUS[Number(v.status)] ?? 'unknown',
  };
}

/** Posición de seller / trade_id en los argumentos de cada función del contrato. */
const ARG_POS = {
  create: { seller: 0, tradeId: 4 },
  release: { seller: 0, tradeId: 1 },
  refund: { seller: 1, tradeId: 2 },
};

/**
 * Comprueba que `txHash` es una tx exitosa que invoca `fn` del contrato `contractId`
 * para `(seller, tradeId)`, posterior a `notBefore`. Devuelve los argumentos decodificados.
 */
export async function verifyInvocation({ txHash, contractId, fn, seller, tradeId, notBefore }) {
  let res;
  try {
    res = await rpcServer().getTransaction(txHash);
  } catch (err) {
    throw unavailable(err);
  }
  if (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    throw badRequest(
      'Transacción no encontrada en Soroban RPC (si acabas de enviarla, espera unos segundos y reintenta)'
    );
  }
  if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw badRequest('La transacción falló on-chain');

  let tx = TransactionBuilder.fromXDR(res.envelopeXdr, config.stellar.networkPassphrase);
  if (tx.innerTransaction) tx = tx.innerTransaction; // fee bump
  const op = tx.operations[0];
  const call =
    op?.type === 'invokeHostFunction' && op.func.type === 'hostFunctionTypeInvokeContract'
      ? op.func.invokeContract
      : null;
  if (!call) throw badRequest('La transacción no invoca un contrato');

  const invoked = Address.fromScAddress(call.contractAddress).toString();
  const name = call.functionName.toString();
  const args = call.args.map((a) => scValToNative(a));
  const pos = ARG_POS[fn];
  if (
    invoked !== contractId ||
    name !== fn ||
    args[pos.seller] !== seller ||
    BigInt(args[pos.tradeId]) !== BigInt(tradeId)
  ) {
    throw badRequest(`La transacción no es un "${fn}" del escrow de esta operación`);
  }
  if (notBefore && res.createdAt < Math.floor(new Date(notBefore).getTime() / 1000) - CLOCK_SKEW_S) {
    throw badRequest('La transacción es anterior a la operación');
  }
  return { args, ledger: res.ledger };
}

/**
 * Verifica el depósito: tx `create` válida y escrow on-chain Funded con el comprador,
 * token y monto exactos del trade. Devuelve `{ refundAfterLedger }`.
 */
export async function verifyEscrowFunded({ txHash, contractId, tokenId, seller, buyer, tradeId, amount, notBefore }) {
  await verifyInvocation({ txHash, contractId, fn: 'create', seller, tradeId, notBefore });
  const escrow = await readEscrow({ contractId, seller, tradeId });
  if (!escrow) throw badRequest('El escrow no existe on-chain');
  const mismatch = [
    escrow.buyer !== buyer && 'comprador',
    escrow.token !== tokenId && 'token',
    escrow.amount !== toStroops(amount) && 'monto',
  ].filter(Boolean);
  if (mismatch.length) throw badRequest(`El escrow on-chain no coincide con la operación (${mismatch.join(', ')})`);
  if (escrow.status !== 'funded') throw badRequest(`El escrow ya no está fondeado (estado on-chain: ${escrow.status})`);
  return { refundAfterLedger: escrow.refundAfterLedger };
}

/** Verifica el cierre: tx `release`/`refund` válida y escrow on-chain en el estado final correspondiente. */
export async function verifyEscrowClosed({ txHash, contractId, fn, seller, tradeId, notBefore }) {
  await verifyInvocation({ txHash, contractId, fn, seller, tradeId, notBefore });
  const escrow = await readEscrow({ contractId, seller, tradeId });
  const expected = fn === 'release' ? 'released' : 'refunded';
  if (escrow?.status !== expected) {
    throw badRequest(
      `El escrow on-chain no está ${expected === 'released' ? 'liberado' : 'reembolsado'} (estado: ${escrow?.status ?? 'inexistente'})`
    );
  }
}
