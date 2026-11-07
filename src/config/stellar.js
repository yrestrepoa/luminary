// Configuración de red del frontend. Valores por defecto: Stellar TESTNET.
// Se puede cambiar en build con variables VITE_* (ver .env.production.example); quedan
// incrustadas en el bundle, así que NUNCA pongas secretos aquí.
// `import.meta.env?.` permite importar este módulo también desde Node (scripts e2e).
const env = import.meta.env ?? {};

const NETWORKS = {
  testnet: {
    passphrase: 'Test SDF Network ; September 2015',
    name: 'TESTNET', // como lo reporta Freighter
    horizon: 'https://horizon-testnet.stellar.org',
    rpc: 'https://soroban-testnet.stellar.org',
    friendbot: 'https://friendbot.stellar.org',
    explorer: 'https://stellar.expert/explorer/testnet',
    usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', // Circle, testnet
  },
  mainnet: {
    passphrase: 'Public Global Stellar Network ; September 2015',
    name: 'PUBLIC',
    horizon: 'https://horizon.stellar.org',
    rpc: null, // sin RPC público por defecto: VITE_SOROBAN_RPC_URL es obligatoria
    friendbot: null, // no existe en mainnet
    explorer: 'https://stellar.expert/explorer/public',
    usdcIssuer: null, // VITE_USDC_ISSUER obligatoria (verifica el emisor oficial de Circle)
  },
};

export const STELLAR_NETWORK = env.VITE_STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
const net = NETWORKS[STELLAR_NETWORK];

export const IS_TESTNET = STELLAR_NETWORK === 'testnet';
export const NETWORK_PASSPHRASE = net.passphrase;
export const NETWORK_NAME = net.name;
export const HORIZON_URL = env.VITE_HORIZON_URL || net.horizon;
// Soroban RPC (contratos). El id del contrato de escrow y del token los entrega la API en cada trade.
export const SOROBAN_RPC_URL = env.VITE_SOROBAN_RPC_URL || net.rpc;
export const FRIENDBOT_URL = IS_TESTNET ? env.VITE_FRIENDBOT_URL || net.friendbot : null;

export const USDC_CODE = 'USDC';
export const USDC_ISSUER = env.VITE_USDC_ISSUER || net.usdcIssuer;

const explorer = (env.VITE_EXPLORER_URL || net.explorer).replace(/\/$/, '');
export const EXPLORER_TX_URL = `${explorer}/tx/`;
export const EXPLORER_ACCOUNT_URL = `${explorer}/account/`;
export const EXPLORER_CONTRACT_URL = `${explorer}/contract/`;

/** Problemas de configuración (se muestran en consola al arrancar; mainnet exige valores explícitos). */
export const STELLAR_CONFIG_PROBLEMS = [
  !SOROBAN_RPC_URL && 'VITE_SOROBAN_RPC_URL es obligatoria en mainnet',
  !USDC_ISSUER && 'VITE_USDC_ISSUER es obligatoria en mainnet',
].filter(Boolean);
