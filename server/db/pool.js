import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

// int8 (BIGINT ids, COUNT(*)) → number. Los ids caben de sobra en 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// NUMERIC se deja como string para no perder precisión; los serializers lo convierten.

/**
 * Pool compartido. Usar SIEMPRE consultas parametrizadas ($1, $2…),
 * nunca interpolar valores en el SQL.
 */
export function createPool(db = config.db, connectionString = config.databaseUrl) {
  const p = new pg.Pool({
    connectionString,
    max: db.max,
    idleTimeoutMillis: db.idleTimeoutMs,
    connectionTimeoutMillis: db.connectionTimeoutMs,
    // Corta en el servidor consultas colgadas (y libera locks); 0 = sin límite.
    statement_timeout: db.statementTimeoutMs || undefined,
    // Transacciones abiertas sin actividad (cliente colgado) no retienen locks indefinidamente.
    idle_in_transaction_session_timeout: db.statementTimeoutMs ? db.statementTimeoutMs * 3 : undefined,
    application_name: 'luminary-api',
    keepAlive: true,
  });
  p.on('error', (err) => {
    // Errores de clientes inactivos (p.ej. el servidor cerró la conexión): no tumbar el proceso.
    logger.error({ err }, '[pg] error en cliente inactivo');
  });
  return p;
}

export const pool = createPool();

/** Atajo: devuelve la primera fila o null. */
export async function one(sql, params, db = pool) {
  const { rows } = await db.query(sql, params);
  return rows[0] ?? null;
}

/**
 * Ejecuta `fn(client)` dentro de una transacción; hace rollback si lanza.
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** true si `err` es una violación de unicidad (23505), opcionalmente de una restricción concreta. */
export const isUniqueViolation = (err, constraint) =>
  err?.code === '23505' && (!constraint || err.constraint === constraint);
