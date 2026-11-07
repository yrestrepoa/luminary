// Configuración de red: Stellar Testnet
export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
export const NETWORK_NAME = 'TESTNET'; // como lo reporta Freighter
export const FRIENDBOT_URL = 'https://friendbot.stellar.org';
// Soroban RPC (contratos). El id del contrato de escrow y del token los entrega la API en cada trade.
export const SOROBAN_RPC_URL =
  import.meta.env?.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';

// USDC de Testnet (emisor oficial de Circle en testnet)
export const USDC_CODE = 'USDC';
export const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

export const EXPLORER_TX_URL = 'https://stellar.expert/explorer/testnet/tx/';
export const EXPLORER_ACCOUNT_URL = 'https://stellar.expert/explorer/testnet/account/';
export const EXPLORER_CONTRACT_URL = 'https://stellar.expert/explorer/testnet/contract/';
