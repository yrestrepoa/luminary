// Aplica server/db/schema.sql y luego server/db/migrations/*.sql (orden alfabético),
// todo idempotente y en una única transacción. Uso: npm run db:migrate
import { readFile, readdir } from 'node:fs/promises';
import { pool } from './pool.js';

const schemaUrl = new URL('./schema.sql', import.meta.url);
const migrationsUrl = new URL('./migrations/', import.meta.url);

async function main() {
  const steps = [{ name: 'schema.sql', sql: await readFile(schemaUrl, 'utf8') }];
  const files = (await readdir(migrationsUrl)).filter((f) => f.endsWith('.sql')).sort();
  for (const name of files) steps.push({ name, sql: await readFile(new URL(name, migrationsUrl), 'utf8') });

  const client = await pool.connect();
  try {
    // Sin parámetros, `pg` usa el protocolo simple y admite varias sentencias.
    // El SQL proviene de archivos del repositorio, nunca de entrada de usuario.
    await client.query('BEGIN');
    for (const step of steps) {
      await client.query(step.sql).catch((err) => {
        err.message = `${step.name}: ${err.message}`;
        throw err;
      });
    }
    await client.query('COMMIT');
    console.log(`✔ Pasos: ${steps.map((s) => s.name).join(', ')}`);
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
