// Prueba de humo end-to-end contra una API en marcha (con BD migrada).
// Uso: API_URL=http://127.0.0.1:4000 npm run test:smoke
// Requiere VERIFY_STELLAR_TX=false en el servidor (usa hashes de transacción ficticios).
import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

const API = (process.env.API_URL ?? 'http://127.0.0.1:4000') + '/api';
let failures = 0;

/** Cliente mínimo con "cookie jar" de una sola cookie. */
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(API + path, {
      method,
      headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = /luminary_token=;|Expires=Thu, 01 Jan 1970/.test(set) ? '' : set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: set };
  };
}

function check(name, cond, extra) {
  console.log(`${cond ? '✔' : '✖'} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`);
  if (!cond) failures++;
}

const tag = randomBytes(4).toString('hex');
const alice = client();
const bob = client();
const fakeHash = () => randomBytes(32).toString('hex');

let r = await alice('GET', '/health');
check('health ok + db ok', r.status === 200 && r.body.db === 'ok', r.body);

r = await alice('POST', '/auth/register', { email: `Alice+${tag}@Example.com`, password: 'supersecret1', displayName: 'Alice' });
check('register 201', r.status === 201 && r.body.user.email === `alice+${tag}@example.com`, r);
check('cookie httpOnly + SameSite=Strict', /HttpOnly/i.test(r.setCookie) && /SameSite=Strict/i.test(r.setCookie), r.setCookie);
check('no password_hash in response', !JSON.stringify(r.body).includes('password'), r.body);

r = await alice('POST', '/auth/register', { email: `ALICE+${tag}@example.com`, password: 'supersecret1', displayName: 'Alice2' });
check('duplicate email (case-insensitive) 409', r.status === 409, r);

r = await alice('POST', '/auth/register', { email: 'bad', password: 'short', displayName: 'x' });
check('register validation 400 with details', r.status === 400 && r.body.details?.email && r.body.details?.password, r.body);

r = await alice('GET', '/auth/me');
check('me 200', r.status === 200 && r.body.user.displayName === 'Alice', r);

r = await alice('POST', '/auth/logout');
check('logout 204', r.status === 204, r);
r = await alice('GET', '/auth/me');
check('me after logout 401', r.status === 401, r);

r = await alice('POST', '/auth/login', { email: `alice+${tag}@example.com`, password: 'wrong-password' });
if (r.status === 429) {
  // El limitador es en memoria: un run previo lo agotó (ver el último check).
  console.error('✖ Login rate limit already exhausted by a previous run: restart the API and run again.');
  process.exit(1);
}
check('login wrong password 401', r.status === 401, r);
r = await alice('POST', '/auth/login', { email: `ALICE+${tag}@example.com`, password: 'supersecret1' });
check('login 200 (email case-insensitive)', r.status === 200, r);
r = await alice('GET', '/auth/me');
check('me after login 200', r.status === 200, r);

r = await alice('POST', '/offers', { type: 'sell', currency: 'COP', price: 4100.5, usdcAmount: 100, min: 10000, max: 1000000, paymentMethod: 'Transferencia', bank: 'Bancolombia' });
check('create offer 201', r.status === 201 && r.body.offer.available === 100 && r.body.offer.merchant === 'Alice', r);
const offerId = r.body?.offer?.id;

r = await alice('POST', '/offers', { type: 'swap', currency: 'cop', price: -1, usdcAmount: 1.123456789, paymentMethod: 'x' });
check('create offer validation 400', r.status === 400 && r.body.details?.type && r.body.details?.usdcAmount, r.body);

r = await bob('POST', '/offers', { type: 'sell', currency: 'COP', price: 1, usdcAmount: 1, paymentMethod: 'Nequi' });
check('create offer unauthenticated 401', r.status === 401, r);

r = await bob('GET', '/offers?type=sell&currency=COP');
check('list offers (public) includes new offer', r.status === 200 && r.body.offers.some((o) => o.id === offerId), r.status);
r = await bob('GET', "/offers?currency=COP' OR 1=1--");
check('injection-looking filter rejected 400', r.status === 400, r);

r = await alice('GET', '/offers/mine');
check('my offers', r.status === 200 && r.body.offers.length === 1, r.body);

r = await bob('POST', '/auth/register', { email: `bob+${tag}@example.com`, password: 'supersecret2', displayName: 'Bob' });
check('register bob', r.status === 201, r);

r = await bob('POST', '/trades', { offerId, usdcAmount: 10 });
check('take offer without Stellar address 400', r.status === 400, r.body);

r = await bob('PATCH', '/users/me', { stellarAddress: 'GABC' });
check('invalid Stellar address 400', r.status === 400, r.body);
const bobAddr = Keypair.random().publicKey();
r = await bob('PATCH', '/users/me', { stellarAddress: bobAddr });
check('link Stellar address', r.status === 200 && r.body.user.stellarAddress === bobAddr, r.body);
r = await alice('PATCH', '/users/me', { stellarAddress: bobAddr });
check('same address on another account 409', r.status === 409, r.body);
r = await alice('PATCH', '/users/me', { stellarAddress: Keypair.random().publicKey(), displayName: 'Alice A.' });
check('update profile', r.status === 200 && r.body.user.displayName === 'Alice A.', r.body);

r = await alice('POST', '/trades', { offerId, usdcAmount: 10 });
check('own offer 400', r.status === 400, r.body);
r = await bob('POST', '/trades', { offerId, usdcAmount: 1000 });
check('amount over available 400', r.status === 400, r.body);
r = await bob('POST', '/trades', { offerId, usdcAmount: 1 });
check('below fiat min 400', r.status === 400, r.body);

r = await bob('POST', '/trades', { offerId, usdcAmount: 10.5 });
check('take offer 201', r.status === 201 && r.body.trade.status === 'pending' && r.body.trade.fiatAmount === 43055.25, r.body);
const t1 = r.body?.trade?.id;
r = await bob('GET', `/offers/${offerId}`);
check('available decremented in NUMERIC', r.body.offer.available === 89.5, r.body);

r = await alice('POST', `/trades/${t1}/paid`);
check('seller cannot mark paid 403', r.status === 403, r.body);
r = await bob('POST', `/trades/${t1}/paid`);
check('buyer marks paid', r.status === 200 && r.body.trade.status === 'paid', r.body);
r = await bob('POST', `/trades/${t1}/release`, { txHash: fakeHash() });
check('buyer cannot release 403', r.status === 403, r.body);
const hash = fakeHash();
r = await alice('POST', `/trades/${t1}/release`, { txHash: hash });
check('seller releases with tx hash', r.status === 200 && r.body.trade.status === 'released' && r.body.trade.stellarTxHash === hash, r.body);
r = await alice('POST', `/trades/${t1}/cancel`);
check('cancel released 409', r.status === 409, r.body);

r = await bob('POST', '/trades', { offerId, usdcAmount: 20 });
const t2 = r.body?.trade?.id;
r = await alice('POST', `/trades/${t2}/cancel`);
check('cancel pending trade', r.status === 200 && r.body.trade.status === 'cancelled', r.body);
r = await bob('GET', `/offers/${offerId}`);
check('available restored after cancel', r.body.offer.available === 89.5, r.body);

r = await bob('GET', '/trades');
check('bob lists trades', r.status === 200 && r.body.trades.length === 2, r.body);
const carol = client();
await carol('POST', '/auth/register', { email: `carol+${tag}@example.com`, password: 'supersecret3', displayName: 'Carol' });
r = await carol('GET', `/trades/${t1}`);
check("other user's trade is 404", r.status === 404, r.body);

r = await alice('PATCH', `/offers/${offerId}`, { status: 'paused' });
check('pause offer', r.status === 200 && r.body.offer.status === 'paused', r.body);
r = await bob('GET', '/offers');
check('paused offer hidden from market', !r.body.offers.some((o) => o.id === offerId), r.body);
r = await carol('PATCH', `/offers/${offerId}`, { status: 'active' });
check("edit someone else's offer 403", r.status === 403, r.body);
r = await alice('GET', '/offers/mine');
check('completed trades counted', r.body.offers[0].trades === 1, r.body);

r = await alice('POST', '/auth/logout');
check('logout', r.status === 204, r);

// Al final: agota el rate limit de login (10 fallos / 15 min por IP).
let last;
for (let i = 0; i < 11; i++) last = await carol('POST', '/auth/login', { email: `nobody+${tag}@example.com`, password: 'x' });
check('login rate limit 429 after 10 failures', last.status === 429, last);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
