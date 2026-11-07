import { cp, mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { describeIntegration } from '../helpers/app.js';
import { DEFAULT_MIGRATIONS_DIR, loadMigrations, migrate, migrationStatus } from '../../db/migrator.js';

describeIntegration('migrations', (ctx) => {
  const tmpDirs = [];
  const copyMigrations = async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lum-mig-'));
    tmpDirs.push(dir);
    await cp(DEFAULT_MIGRATIONS_DIR, dir, { recursive: true });
    return { dir, url: pathToFileURL(dir + path.sep) };
  };

  afterAll(async () => {
    await ctx.pool.query('DROP TABLE IF EXISTS _migration_probe');
    await ctx.pool.query("DELETE FROM schema_migrations WHERE version = '999'");
    await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it('records every migration once and is a no-op on re-run', async () => {
    const files = await loadMigrations();
    const second = await migrate(ctx.pool); // la primera corrió en beforeAll
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(files.map((f) => f.name));
    const { rows } = await ctx.pool.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
    expect(rows).toEqual(files.map((f) => ({ version: f.version, name: f.name, checksum: f.checksum })));
    const status = await migrationStatus(ctx.pool);
    expect(status.every((s) => s.appliedAt instanceof Date)).toBe(true);
  });

  it('applies only new migrations', async () => {
    const { dir, url } = await copyMigrations();
    await writeFile(path.join(dir, '999_probe.sql'), 'CREATE TABLE _migration_probe (id int);');
    const res = await migrate(ctx.pool, { dir: url });
    expect(res.applied).toEqual(['999_probe.sql']);
    expect((await migrate(ctx.pool, { dir: url })).applied).toEqual([]);
  });

  it('refuses to run when an applied migration was edited', async () => {
    const { dir, url } = await copyMigrations();
    await appendFile(path.join(dir, '002_escrow.sql'), '\n-- edited after being applied\n');
    await expect(migrate(ctx.pool, { dir: url })).rejects.toThrow(/002_escrow\.sql cambió/);
  });

  it('rolls back a failing migration entirely', async () => {
    const { dir, url } = await copyMigrations();
    await writeFile(path.join(dir, '998_broken.sql'), 'CREATE TABLE _broken_probe (id int);\nSELECT * FROM nope;');
    await expect(migrate(ctx.pool, { dir: url })).rejects.toThrow(/998_broken\.sql/);
    const { rows } = await ctx.pool.query("SELECT to_regclass('_broken_probe') AS t");
    expect(rows[0].t).toBeNull();
    const rec = await ctx.pool.query("SELECT 1 FROM schema_migrations WHERE version = '998'");
    expect(rec.rowCount).toBe(0);
  });

  it('rejects badly named or duplicated migration files', async () => {
    const a = await copyMigrations();
    await writeFile(path.join(a.dir, 'oops.sql'), 'SELECT 1;');
    await expect(loadMigrations(a.url)).rejects.toThrow(/Nombre de migración inválido/);
    const b = await copyMigrations();
    await writeFile(path.join(b.dir, '002_again.sql'), 'SELECT 1;');
    await expect(loadMigrations(b.url)).rejects.toThrow(/duplicada/);
  });
});
