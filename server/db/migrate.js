// CLI de migraciones. Uso:
//   npm run db:migrate              aplica las pendientes (server/db/migrations/NNN_*.sql)
//   npm run db:migrate -- --status  lista aplicadas y pendientes
// Ver server/db/migrator.js para el funcionamiento (schema_migrations, checksums, advisory lock).
import { pool } from './pool.js';
import { migrate, migrationStatus } from './migrator.js';

async function main() {
  if (process.argv.includes('--status')) {
    for (const m of await migrationStatus(pool)) {
      console.log(
        `${m.appliedAt ? '✔' : '·'} ${m.name}${m.appliedAt ? `  (${m.appliedAt.toISOString()})` : '  pendiente'}`
      );
    }
    return;
  }
  const { applied, skipped } = await migrate(pool, { log: (msg) => console.log(`✔ ${msg}`) });
  const { rows } = await pool.query('SELECT current_database() AS db');
  console.log(
    applied.length
      ? `✔ ${applied.length} migración(es) aplicada(s) en "${rows[0].db}"; ${skipped.length} ya estaban aplicadas.`
      : `✔ "${rows[0].db}" ya está al día (${skipped.length} migraciones aplicadas).`
  );
}

main()
  .catch((err) => {
    console.error('✖ Error en la migración:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
