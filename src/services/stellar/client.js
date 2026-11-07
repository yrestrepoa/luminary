import { Horizon, Asset } from '@stellar/stellar-sdk';
import { HORIZON_URL, USDC_CODE, USDC_ISSUER } from '../../config/stellar.js';

export const server = new Horizon.Server(HORIZON_URL);
export const USDC = new Asset(USDC_CODE, USDC_ISSUER);
