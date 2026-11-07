// Migraciones versionadas de PostgreSQL con registro en `schema_migrations`.
//
// - Cada archivo server/db/migrations/NNN_nombre.sql se aplica UNA vez, en orden, cada uno en
//   su propia transacción junto con su fila en schema_migrations (o se aplica entero o nada).
// - Se guarda el SHA-256 del archivo: si una migración ya aplicada cambia, se aborta (los
//   archivos aplicados son inmutables; los cambios van en una migración nueva).
// - Un advisory lock evita que dos procesos (p.ej. dos réplicas arrancando) migren a la vez.
// - 001 y 002 son idempotentes porque existían antes del registro: en bases creadas con la
//   versión anterior se re-aplican sin efecto y quedan registradas (baseline automático).
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

export const DEFAULT_MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
const LOCK_KEY = 72_340_172; // arbitrario y estable: pg_advisory_lock(LOCK_KEY)
const FILE_RE = /^(\d{3,})_[\w-]+\.sql$/;

/** Lee los archivos de migración ordenados por versión. */
export async function loadMigrations(dir = DEFAULT_MIGRATIONS_DIR) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set();
  const out = [];
  for (const name of files) {
    const m = FILE_RE.exec(name);
    if (!m) throw new Error(`Nombre de migración inválido: ${name} (esperado NNN_nombre.sql)`);
    if (seen.has(m[1])) throw new Error(`Versión de migración duplicada: ${m[1]}`);
    seen.add(m[1]);
    const sql = await readFile(new URL(name, dir), 'utf8');
    out.push({ version: m[1], name, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  return out;
}

/**
 * Aplica las migraciones pendientes. Devuelve { applied: string[], skipped: string[] }.
 * @param {import('pg').Pool} pool
 */
export async function migrate(pool, { dir = DEFAULT_MIGRATIONS_DIR, log = () => {} } = {}) {
  const migrations = await loadMigrations(dir);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     text        PRIMARY KEY,
        name        text        NOT NULL,
        checksum    char(64)    NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query('SELECT version, name, checksum FROM schema_migrations');
    const done = new Map(rows.map((r) => [r.version, r]));

    const applied = [];
    const skipped = [];
    for (const m of migrations) {
      const prev = done.get(m.version);
      if (prev) {
        if (prev.checksum !== m.checksum) {
          throw new Error(
            `La migración ${m.name} cambió después de aplicarse (checksum distinto). ` +
              'No edites migraciones aplicadas: crea una nueva.'
          );
        }
        skipped.push(m.name);
        continue;
      }
      try {
        await client.query('BEGIN');
        // Sin parámetros, `pg` usa el protocolo simple y admite varias sentencias.
        // El SQL proviene de archivos del repositorio, nunca de entrada de usuario.
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          m.version,
          m.name,
          m.checksum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        err.message = `${m.name}: ${err.message}`;
        throw err;
      }
      applied.push(m.name);
      log(`applied ${m.name}`);
    }
    return { applied, skipped };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/** Estado: migraciones aplicadas (con fecha) y pendientes. */
export async function migrationStatus(pool, { dir = DEFAULT_MIGRATIONS_DIR } = {}) {
  const migrations = await loadMigrations(dir);
  const { rows: exists } = await pool.query("SELECT to_regclass('schema_migrations') IS NOT NULL AS ok");
  const rows = exists[0].ok
    ? (await pool.query('SELECT version, applied_at FROM schema_migrations ORDER BY version')).rows
    : [];
  const at = new Map(rows.map((r) => [r.version, r.applied_at]));
  return migrations.map((m) => ({ name: m.name, appliedAt: at.get(m.version) ?? null }));
}
