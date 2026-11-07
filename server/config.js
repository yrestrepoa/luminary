import 'dotenv/config';
import { Asset, Networks, StrKey } from '@stellar/stellar-sdk';

/** Lee una variable de entorno obligatoria (falla al arrancar si falta). */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Falta la variable de entorno ${name} (ver .env.example)`);
  }
  return value;
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';

export const config = {
  env: NODE_ENV,
  isProd: NODE_ENV === 'production',
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 4000),
  // DATABASE_URL tiene prioridad; si no está, `pg` usa PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
  databaseUrl: process.env.DATABASE_URL || undefined,
  // Redis para rate limit y revocación de tokens. Vacío → memoria del proceso (solo desarrollo).
  redisUrl: process.env.REDIS_URL || undefined,
  jwt: {
    get secret() {
      const s = required('JWT_SECRET');
      if (s.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
      return s;
    },
    expiresIn: '7d',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },
  cookieName: 'luminary_token',
  stellar: {
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET,
    rpcUrl: process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
    usdcIssuer: process.env.USDC_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    // Contrato luminary-escrow desplegado (contract-luminary/contracts/escrow). Sin él no se puede fondear.
    escrowContractId: optionalContractId('ESCROW_CONTRACT_ID'),
    // Token del escrow: el SAC de USDC por defecto; ESCROW_TOKEN_ID permite otro SAC (pruebas).
    get escrowTokenId() {
      return (
        optionalContractId('ESCROW_TOKEN_ID') ?? new Asset('USDC', this.usdcIssuer).contractId(this.networkPassphrase)
      );
    },
    // Verifica on-chain (Soroban RPC) el escrow antes de cambiar el estado de un trade.
    // false solo para pruebas locales sin red (npm run test:smoke usa hashes ficticios).
    verifyTx: (process.env.VERIFY_STELLAR_TX ?? 'true') !== 'false',
  },
};

/** Lee un id de contrato C… opcional; falla al arrancar si tiene formato inválido. */
function optionalContractId(name) {
  const value = process.env[name];
  if (!value) return null;
  if (!StrKey.isValidContract(value)) throw new Error(`${name} no es un id de contrato Stellar válido (C…)`);
  return value;
}
