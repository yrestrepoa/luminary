// Aplica server/db/schema.sql (idempotente) en una transacción. Uso: npm run db:migrate
import { readFile } from 'node:fs/promises';
import { pool } from './pool.js';

const schemaUrl = new URL('./schema.sql', import.meta.url);

async function main() {
  const sql = await readFile(schemaUrl, 'utf8');
  const client = await pool.connect();
  try {
    // Sin parámetros, `pg` usa el protocolo simple y admite varias sentencias.
    // El SQL proviene de un archivo del repositorio, nunca de entrada de usuario.
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    const { rows } = await client.query(
      `SELECT current_database() AS db, string_agg(table_name, ', ' ORDER BY table_name) AS tables
         FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`
    );
    console.log(`✔ Migración aplicada en "${rows[0].db}". Tablas: ${rows[0].tables}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('✖ Error en la migración:', err.message);
  process.exit(1);
});
