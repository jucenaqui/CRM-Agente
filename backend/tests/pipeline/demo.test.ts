import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const cwd = path.resolve(__dirname, '../..');
const run = (script: string, db: string, args: string[] = [], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', script, ...args], {
    cwd,
    env: { ...process.env, VITEST: '', NODE_ENV: 'development', JWT_SECRET: 'x'.repeat(40), DB_PATH: db, BCRYPT_ROUNDS: '4', ...env },
    encoding: 'utf8',
    timeout: 90_000,
  });

const counts = (file: string) => {
  const db = new Database(file, { readonly: true });
  const n = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const out = {
    companies: n('companies'),
    contacts: n('contacts'),
    deals: n('deals'),
    activities: n('activities'),
    history: n('deal_stage_history'),
    users: n('users'),
  };
  db.close();
  return out;
};

describe('demo data (npm run seed:demo)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newcrm-demo-'));
  const file = path.join(dir, 'demo.db');

  it('adds a year of realistic activity, and --remove restores the database exactly', () => {
    expect(run('src/seed.ts', file).status).toBe(0);
    const before = counts(file);

    const added = run('src/seed-demo.ts', file);
    expect(added.status, added.stderr).toBe(0);
    const during = counts(file);
    expect(during.deals).toBeGreaterThan(before.deals + 60);
    expect(during.companies).toBe(before.companies + 14);
    expect(during.users).toBe(before.users + 1); // the demo salesperson
    expect(during.history).toBeGreaterThan(during.deals); // every deal has at least one history row, most several

    // the data tells a story the metrics can read: won, lost with reasons, open ones, stalled ones, sources
    const db = new Database(file, { readonly: true });
    const q = (sql: string) => db.prepare(sql).all() as Record<string, number>[];
    expect(q("SELECT COUNT(*) n FROM deals WHERE stage = 'won' AND closedAt IS NOT NULL")[0]!.n).toBeGreaterThan(15);
    expect(q("SELECT COUNT(*) n FROM deals WHERE stage = 'lost' AND lostReasonId IS NOT NULL")[0]!.n).toBeGreaterThan(15);
    expect(q("SELECT COUNT(DISTINCT sourceId) n FROM deals WHERE sourceId IS NOT NULL")[0]!.n).toBeGreaterThanOrEqual(5);
    expect(q("SELECT COUNT(DISTINCT strftime('%Y-%m', closedAt)) n FROM deals WHERE closedAt IS NOT NULL")[0]!.n).toBeGreaterThanOrEqual(10); // spread over the year
    expect(q("SELECT COUNT(*) n FROM deals WHERE closedAt IS NULL AND ownerId IN (SELECT id FROM users)")[0]!.n).toBeGreaterThanOrEqual(16);
    expect(q("SELECT COUNT(*) n FROM activities WHERE completed = 1 AND completedAt IS NOT NULL")[0]!.n).toBeGreaterThan(60);
    // no deal closes in the future, and history never predates the deal
    expect(q(`SELECT COUNT(*) n FROM deals WHERE closedAt > '${new Date().toISOString()}'`)[0]!.n).toBe(0);
    expect(q('SELECT COUNT(*) n FROM deal_stage_history h JOIN deals d ON d.id = h.dealId WHERE h.changedAt < d.createdAt')[0]!.n).toBe(0);
    expect(q('PRAGMA foreign_key_check')).toEqual([]);
    db.close();

    // running it again changes nothing
    const again = run('src/seed-demo.ts', file);
    expect(again.stdout).toMatch(/ya están cargados/);
    expect(counts(file)).toEqual(during);

    const removed = run('src/seed-demo.ts', file, ['--remove']);
    expect(removed.status, removed.stderr).toBe(0);
    expect(counts(file)).toEqual(before);
    expect(run('src/seed-demo.ts', file, ['--remove']).stdout).toMatch(/No hay datos de demostración/);
  });

  it('never touches records that are not demo data', () => {
    const f2 = path.join(dir, 'mine.db');
    run('src/seed.ts', f2);
    const db = new Database(f2);
    db.prepare("INSERT INTO companies (name, ownerId, createdAt, updatedAt) VALUES ('Mi empresa real', 1, datetime('now'), datetime('now'))").run();
    db.close();
    const before = counts(f2);
    run('src/seed-demo.ts', f2);
    run('src/seed-demo.ts', f2, ['--remove']);
    expect(counts(f2)).toEqual(before);
    const check = new Database(f2, { readonly: true });
    expect((check.prepare("SELECT COUNT(*) n FROM companies WHERE name = 'Mi empresa real'").get() as { n: number }).n).toBe(1);
    check.close();
  });

  it('refuses to run in production unless forced', () => {
    const f3 = path.join(dir, 'prod.db');
    const r = run('src/seed-demo.ts', f3, [], { NODE_ENV: 'production' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NODE_ENV=production/);
    expect(fs.existsSync(f3)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
