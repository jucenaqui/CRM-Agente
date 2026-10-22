import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { jwtSecretWarning } from '../../src/config';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('SEC-004: JWT_SECRET warning', () => {
  // vitest runs with NODE_ENV=test / VITEST set, which silences the warning; emulate a dev run.
  const asDev = (secret?: string) => {
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';
    if (secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secret;
  };

  it('warns when no secret is set outside production', () => {
    asDev();
    expect(jwtSecretWarning()).toMatch(/JWT_SECRET no está definido/);
    asDev('');
    expect(jwtSecretWarning()).not.toBeNull();
  });

  it('is silent when a secret is set, in production (which refuses to start instead) and in tests', () => {
    asDev('un-secreto-largo-y-aleatorio-0123456789abcdef');
    expect(jwtSecretWarning()).toBeNull();
    asDev();
    process.env.NODE_ENV = 'production';
    expect(jwtSecretWarning()).toBeNull();
    process.env.NODE_ENV = 'test';
    expect(jwtSecretWarning()).toBeNull();
  });
});

describe('SEC-005: seed in production', () => {
  const runSeed = (extra: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newcrm-seed-'));
    const db = path.join(dir, 'seed.db');
    const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/seed.ts'], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, VITEST: '', NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), DB_PATH: db, BCRYPT_ROUNDS: '4', ...extra },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { r, db, dir };
  };

  it('refuses to run (exit 1) and creates no database or users', () => {
    const { r, db, dir } = runSeed({});
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Seed cancelado/);
    expect(fs.existsSync(db)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('runs only when explicitly forced with SEED_ALLOW_PRODUCTION=1', () => {
    const { r, db, dir } = runSeed({ SEED_ALLOW_PRODUCTION: '1' });
    expect(r.status).toBe(0);
    expect(fs.existsSync(db)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
