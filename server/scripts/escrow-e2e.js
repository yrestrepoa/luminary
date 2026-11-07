// Prueba end-to-end del escrow en Stellar TESTNET, sin navegador ni Freighter.
// Uso: ESCROW_CONTRACT_ID=C… npm run test:escrow-e2e
//
// Genera cuentas desechables (fondeadas con Friendbot; las claves solo viven en memoria),
// emite un activo de prueba y despliega su Stellar Asset Contract (sustituye al USDC de
// Circle, que no se puede obtener por script). Luego ejecuta con el cliente del frontend
// (src/services/stellar/escrow.js, firmando con claves en vez de Freighter):
//   1) create → release, y lo verifica con los verificadores del servidor (server/utils/escrow.js)
//   2) create → refund del comprador
//   3) casos negativos: el comprador no puede liberar, el vendedor no puede reclamar antes
//      del plazo, y el servidor rechaza datos que no coinciden.
import { Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder, rpc } from '@stellar/stellar-sdk';

if (!process.env.ESCROW_CONTRACT_ID) {
  console.error('Define ESCROW_CONTRACT_ID (contrato luminary-escrow desplegado en testnet).');
  process.exit(2);
}

const HORIZON = 'https://horizon-testnet.stellar.org';
const PASSPHRASE = 'Test SDF Network ; September 2015';
const horizon = new Horizon.Server(HORIZON);
const soroban = new rpc.Server(process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org');

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '✔' : '✖'} ${name}${!cond && extra !== undefined ? ` → ${extra}` : ''}`);
  if (!cond) failures++;
}
async function expectError(name, promise, pattern) {
  try {
    await promise;
    check(name, false, 'no lanzó error');
  } catch (err) {
    check(name, pattern.test(err.message ?? ''), err.message);
  }
}

const issuer = Keypair.random();
const seller = Keypair.random();
const buyer = Keypair.random();
const asset = new Asset('LUMT', issuer.publicKey());
const tokenId = asset.contractId(PASSPHRASE);

// Los módulos del servidor leen la config de process.env al importarse.
process.env.ESCROW_TOKEN_ID = tokenId;
const { verifyEscrowFunded, verifyEscrowClosed, readEscrow } = await import('../utils/escrow.js');
const { fundEscrow, releaseEscrow, refundEscrow, getEscrow } = await import('../../src/services/stellar/escrow.js');
const contractId = process.env.ESCROW_CONTRACT_ID;

async function classic(kp, ops) {
  const account = await horizon.loadAccount(kp.publicKey());
  const b = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE });
  ops.forEach((op) => b.addOperation(op));
  const tx = b.setTimeout(60).build();
  tx.sign(kp);
  return horizon.submitTransaction(tx);
}

async function balance(pub) {
  const acc = await horizon.loadAccount(pub);
  return acc.balances.find((b) => b.asset_code === 'LUMT' && b.asset_issuer === issuer.publicKey())?.balance;
}

console.log(`Contrato: ${contractId}\nToken de prueba: LUMT:${issuer.publicKey()} (SAC ${tokenId})`);
console.log(`Vendedor: ${seller.publicKey()}\nComprador: ${buyer.publicKey()}\n`);

// ---------------------------------------------------------------- preparación
await Promise.all(
  [issuer, seller, buyer].map(async (kp) => {
    const res = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
    if (!res.ok) throw new Error(`Friendbot falló para ${kp.publicKey()}: ${res.status}`);
  })
);
check('cuentas fondeadas con Friendbot', true);

await classic(seller, [Operation.changeTrust({ asset })]);
await classic(buyer, [Operation.changeTrust({ asset })]);
await classic(issuer, [Operation.payment({ destination: seller.publicKey(), asset, amount: '100' })]);
check('trustlines + 100 LUMT al vendedor', (await balance(seller.publicKey())) === '100.0000000');

{
  const account = await soroban.getAccount(issuer.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.createStellarAssetContract({ asset }))
    .setTimeout(60)
    .build();
  const prepared = await soroban.prepareTransaction(tx);
  prepared.sign(issuer);
  const sent = await soroban.sendTransaction(prepared);
  const res = await soroban.pollTransaction(sent.hash, { attempts: 30, sleepStrategy: () => 1000 });
  check('SAC del token de prueba desplegado', res.status === 'SUCCESS', res.status);
}

const tradeA = BigInt(Date.now()); // ids únicos por ejecución
const tradeB = tradeA + 1n;
const createdAt = new Date(Date.now() - 5_000);
const base = { contractId, seller: seller.publicKey(), buyer: buyer.publicKey(), tokenId };

// ---------------------------------------------------------------- 1) create → release
const fundA = await fundEscrow({ ...base, amountStroops: '105000000', tradeId: tradeA }, seller.secret());
check('create (vendedor) confirmado', /^[a-f0-9]{64}$/.test(fundA.hash), fundA.hash);
check('vendedor descontado 10.5', (await balance(seller.publicKey())) === '89.5000000');

const escrowA = await getEscrow({ contractId, seller: seller.publicKey(), tradeId: tradeA });
check(
  'get_escrow (frontend) → funded',
  escrowA?.status === 'funded' && escrowA.amount === 105000000n,
  JSON.stringify(escrowA, (k, v) => (typeof v === 'bigint' ? String(v) : v))
);

const funded = await verifyEscrowFunded({
  txHash: fundA.hash,
  ...base,
  tradeId: tradeA,
  amount: '10.5',
  notBefore: createdAt,
});
check('servidor verifica el depósito', funded.refundAfterLedger > 0, JSON.stringify(funded));

await expectError(
  'servidor rechaza monto distinto',
  verifyEscrowFunded({ txHash: fundA.hash, ...base, tradeId: tradeA, amount: '11', notBefore: createdAt }),
  /monto/
);
await expectError(
  'servidor rechaza otro comprador',
  verifyEscrowFunded({
    txHash: fundA.hash,
    ...base,
    buyer: issuer.publicKey(),
    tradeId: tradeA,
    amount: '10.5',
    notBefore: createdAt,
  }),
  /comprador/
);
await expectError(
  'servidor rechaza otro trade id',
  verifyEscrowFunded({ txHash: fundA.hash, ...base, tradeId: tradeA + 99n, amount: '10.5', notBefore: createdAt }),
  /no es un "create"/
);
await expectError(
  'servidor rechaza hash inexistente',
  verifyEscrowFunded({ txHash: 'ab'.repeat(32), ...base, tradeId: tradeA, amount: '10.5', notBefore: createdAt }),
  /no encontrada/
);
await expectError(
  'servidor rechaza tx anterior al trade',
  verifyEscrowFunded({
    txHash: fundA.hash,
    ...base,
    tradeId: tradeA,
    amount: '10.5',
    notBefore: new Date(Date.now() + 3_600_000),
  }),
  /anterior/
);

await expectError(
  'crear dos veces el mismo escrow falla',
  fundEscrow({ ...base, amountStroops: '1', tradeId: tradeA }, seller.secret()),
  /Ya existe/
);
await expectError(
  'el comprador no puede liberar',
  releaseEscrow({ contractId, seller: seller.publicKey(), tradeId: tradeA }, buyer.secret()),
  /autorizada|Auth/
);
await expectError(
  'el vendedor no puede reclamar antes del plazo',
  refundEscrow(
    { contractId, caller: seller.publicKey(), seller: seller.publicKey(), tradeId: tradeA },
    seller.secret()
  ),
  /plazo/
);
await expectError(
  'servidor: release aún no ocurrió',
  verifyEscrowClosed({
    txHash: fundA.hash,
    contractId,
    fn: 'release',
    seller: seller.publicKey(),
    tradeId: tradeA,
    notBefore: createdAt,
  }),
  /no es un "release"/
);

const releaseA = await releaseEscrow({ contractId, seller: seller.publicKey(), tradeId: tradeA }, seller.secret());
check('release (vendedor) confirmado', /^[a-f0-9]{64}$/.test(releaseA.hash));
check('comprador recibió 10.5', (await balance(buyer.publicKey())) === '10.5000000');
await verifyEscrowClosed({
  txHash: releaseA.hash,
  contractId,
  fn: 'release',
  seller: seller.publicKey(),
  tradeId: tradeA,
  notBefore: createdAt,
});
check('servidor verifica la liberación', true);
await expectError(
  'servidor rechaza release como refund',
  verifyEscrowClosed({
    txHash: releaseA.hash,
    contractId,
    fn: 'refund',
    seller: seller.publicKey(),
    tradeId: tradeA,
    notBefore: createdAt,
  }),
  /no es un "refund"/
);
await expectError(
  'doble release falla',
  releaseEscrow({ contractId, seller: seller.publicKey(), tradeId: tradeA }, seller.secret()),
  /ya fue liberado/
);

// ---------------------------------------------------------------- 2) create → refund (comprador)
const fundB = await fundEscrow({ ...base, amountStroops: '20000000', tradeId: tradeB }, seller.secret());
check('create B confirmado', Boolean(fundB.hash));
const refundB = await refundEscrow(
  { contractId, caller: buyer.publicKey(), seller: seller.publicKey(), tradeId: tradeB },
  buyer.secret()
);
check('refund (comprador) confirmado', Boolean(refundB.hash));
check('vendedor recuperó los 2 LUMT', (await balance(seller.publicKey())) === '89.5000000');
await verifyEscrowClosed({
  txHash: refundB.hash,
  contractId,
  fn: 'refund',
  seller: seller.publicKey(),
  tradeId: tradeB,
  notBefore: createdAt,
});
check('servidor verifica el reembolso', true);
const stateB = await readEscrow({ contractId, seller: seller.publicKey(), tradeId: tradeB });
check('get_escrow (servidor) → refunded', stateB?.status === 'refunded');

console.log(`\nTx: create ${fundA.hash}\n    release ${releaseA.hash}\n    refund ${refundB.hash}`);
console.log(failures ? `\n${failures} check(s) failed` : '\nAll escrow e2e checks passed');
process.exit(failures ? 1 : 0);
