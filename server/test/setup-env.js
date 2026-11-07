// Entorno de pruebas del servidor. Se ejecuta antes de importar cualquier módulo de server/,
// porque config.js lee process.env al cargarse. Nunca usa .env (ver server/config.js).
import { randomBytes } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.VERIFY_STELLAR_TX = 'false';
// Integración: BD/Redis desechables. Sin TEST_REDIS_URL se usa el almacén en memoria.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://luminary:unused@127.0.0.1:1/luminary_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? '';
// Pool pequeño y timeouts cortos: un servicio caído falla rápido en vez de colgar la suite.
process.env.DB_POOL_MAX = '5';
process.env.DB_CONNECTION_TIMEOUT_MS = '2000';
// Contrato y token ficticios (formato válido) para las pruebas de escrow.
process.env.ESCROW_CONTRACT_ID ??= 'CA77HZ3YHCNKXG6M2OZKN7QAI7UDEEOX2AHDEQU5LO4DTD7QHI6K6BOI';
