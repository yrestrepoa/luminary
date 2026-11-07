// Cliente del contrato luminary-escrow (Soroban). Módulo puro: recibe un firmante
// ({ publicKey, sign(xdr) }) — en la app, freighterSigner(address); en scripts, una clave secreta.
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE, SOROBAN_RPC_URL } from '../../config/stellar.js';
import { toSigner } from './signer.js';

export const sorobanServer = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: SOROBAN_RPC_URL.startsWith('http://') });

/** Índice = enum Status del contrato. */
export const ESCROW_STATUS = ['funded', 'released', 'refunded'];

const CONTRACT_ERRORS = {
  1: 'Ya existe un escrow para esta operación',
  2: 'Escrow no encontrado',
  3: 'El escrow ya fue liberado o reembolsado',
  4: 'Monto inválido',
  5: 'Vendedor y comprador deben ser distintos',
  6: 'Aún no puedes reclamar: el plazo de reembolso no ha vencido',
  7: 'Solo el comprador o el vendedor pueden reembolsar',
};

const u64 = (v) => nativeToScVal(BigInt(v), { type: 'u64' });
const i128 = (v) => nativeToScVal(BigInt(v), { type: 'i128' });
const addr = (a) => new Address(a).toScVal();

/** Traduce errores de simulación/envío a mensajes legibles (errores del contrato por código). */
export function escrowError(err) {
  const msg = typeof err === 'string' ? err : err?.message ?? String(err);
  const code = /Error\(Contract, #(\d+)\)/.exec(msg)?.[1];
  if (code && CONTRACT_ERRORS[code]) return new Error(CONTRACT_ERRORS[code]);
  if (/trustline|TrustlineMissing|Error\(Contract, #13\)/i.test(msg)) return new Error('Falta la trustline USDC en una de las cuentas');
  if (/balance|Error\(Contract, #10\)/i.test(msg)) return new Error('Balance USDC insuficiente');
  if (/Error\(Auth/.test(msg)) return new Error('Firma no autorizada para esta acción');
  return new Error(`Transacción rechazada: ${msg.slice(0, 240)}`);
}

/**
 * Simula, firma, envía y espera la confirmación de una invocación del contrato.
 * `onSubmitted(hash)` se llama en cuanto la red acepta la tx (antes de confirmarse), para
 * poder guardar el hash y no repetir la operación si algo falla después.
 * @returns {Promise<{ hash: string, result: any }>}
 */
async function invoke(signerInput, contractId, method, args, { onSubmitted } = {}) {
  const signer = toSigner(signerInput);
  const account = await sorobanServer.getAccount(signer.publicKey);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(180)
    .build();

  let prepared;
  try {
    prepared = await sorobanServer.prepareTransaction(tx); // simula: auth, recursos y fee
  } catch (err) {
    throw escrowError(err);
  }
  // Si el contrato exige la firma de otra cuenta (p.ej. el comprador intenta liberar), la tx
  // fallaría on-chain: se corta antes de firmar y pagar la fee.
  const others = (prepared.operations[0].auth ?? [])
    .map((entry) => entry.credentials)
    .filter((cred) => cred.type !== 'sorobanCredentialsSourceAccount')
    .map((cred) => Address.fromScAddress((cred.address ?? cred.addressV2 ?? cred.addressWithDelegates).address).toString())
    .filter((a) => a !== signer.publicKey);
  if (others.length) throw new Error(`Firma no autorizada para esta acción: requiere la cuenta ${others[0]}`);

  const signed = TransactionBuilder.fromXDR(await signer.sign(prepared.toXDR()), NETWORK_PASSPHRASE);
  const sent = await sorobanServer.sendTransaction(signed);
  if (sent.status === 'ERROR' || sent.status === 'TRY_AGAIN_LATER') {
    throw new Error(sent.status === 'ERROR' ? 'La red rechazó la transacción' : 'Red congestionada; intenta de nuevo');
  }
  onSubmitted?.(sent.hash);

  const res = await sorobanServer.pollTransaction(sent.hash, { attempts: 30, sleepStrategy: () => 1_000 });
  if (res.status === 'NOT_FOUND') throw new Error(`Transacción enviada (${sent.hash}) pero aún sin confirmar; reintenta el registro en unos segundos`);
  if (res.status !== 'SUCCESS') throw new Error(`La transacción falló on-chain (${sent.hash})`);
  return { hash: sent.hash, result: res.returnValue ? scValToNative(res.returnValue) : null };
}

/** Vendedor: deposita `amountStroops` del token en el escrow del trade. */
export function fundEscrow({ contractId, tokenId, seller, buyer, amountStroops, tradeId }, signer, opts) {
  return invoke(signer, contractId, 'create', [addr(seller), addr(buyer), addr(tokenId), i128(amountStroops), u64(tradeId)], opts);
}

/** Vendedor: libera el USDC al comprador. */
export function releaseEscrow({ contractId, seller, tradeId }, signer, opts) {
  return invoke(signer, contractId, 'release', [addr(seller), u64(tradeId)], opts);
}

/** Comprador (siempre) o vendedor (tras el plazo): devuelve el USDC al vendedor. `caller` = quien firma. */
export function refundEscrow({ contractId, caller, seller, tradeId }, signer, opts) {
  return invoke(signer, contractId, 'refund', [addr(caller), addr(seller), u64(tradeId)], opts);
}

/** Lee el escrow (simulación, sin firma). null si no existe. */
export async function getEscrow({ contractId, seller, tradeId }) {
  const tx = new TransactionBuilder(new Account(seller, '0'), { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call('get_escrow', addr(seller), u64(tradeId)))
    .setTimeout(30)
    .build();
  const sim = await sorobanServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    if (sim.error.includes('Error(Contract, #2)')) return null;
    throw escrowError(sim.error);
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

/** Último ledger cerrado (para saber si el vendedor ya puede reclamar). */
export async function latestLedger() {
  return (await sorobanServer.getLatestLedger()).sequence;
}
