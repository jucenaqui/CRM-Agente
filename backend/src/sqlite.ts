/**
 * Thin SQLite adapter.
 *
 * Primary driver: `better-sqlite3` (contract). If its native binary cannot be loaded for the
 * running Node version (e.g. no prebuild for that ABI), falls back to the built-in `node:sqlite`
 * (available without flags on Node >= 22.13 / 24). Both expose the same minimal API below.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Statement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): RunResult;
}

export interface SqliteDb {
  readonly driver: 'better-sqlite3' | 'node:sqlite';
  prepare(sql: string): Statement;
  exec(sql: string): void;
  /** Wraps `fn` in BEGIN/COMMIT (ROLLBACK on throw). Nested calls join the outer transaction. */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  close(): void;
}

type BetterCtor = new (file: string) => {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  transaction<F extends (...a: never[]) => unknown>(fn: F): F;
  close(): void;
};

let betterCtor: BetterCtor | null | undefined;

function loadBetter(): BetterCtor | null {
  if (betterCtor !== undefined) return betterCtor;
  try {
    const Ctor = require('better-sqlite3') as BetterCtor;
    new Ctor(':memory:').close(); // forces the native binding to load
    betterCtor = Ctor;
  } catch {
    betterCtor = null;
  }
  return betterCtor;
}

function openBetter(Ctor: BetterCtor, file: string): SqliteDb {
  const db = new Ctor(file);
  return {
    driver: 'better-sqlite3',
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => void db.exec(sql),
    transaction: (fn) => db.transaction(fn as never) as never,
    close: () => db.close(),
  };
}

function openNode(file: string): SqliteDb {
  let mod: { DatabaseSync: new (file: string) => any };
  try {
    mod = require('node:sqlite');
  } catch {
    throw new Error(
      'No SQLite driver available: better-sqlite3 failed to load and node:sqlite is unavailable. ' +
        'Run `npm rebuild better-sqlite3` or use Node >= 22.13.',
    );
  }
  const db = new mod.DatabaseSync(file);
  let depth = 0;
  return {
    driver: 'node:sqlite',
    prepare: (sql) => {
      const st = db.prepare(sql);
      return {
        get: (...p) => st.get(...p),
        all: (...p) => st.all(...p),
        run: (...p) => st.run(...p) as RunResult,
      };
    },
    exec: (sql) => db.exec(sql),
    transaction:
      (fn) =>
      (...args) => {
        if (depth > 0) return fn(...args);
        db.exec('BEGIN');
        depth++;
        try {
          const r = fn(...args);
          db.exec('COMMIT');
          return r;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        } finally {
          depth--;
        }
      },
    close: () => db.close(),
  };
}

export function openSqlite(file: string): SqliteDb {
  const forced = process.env.SQLITE_DRIVER;
  if (forced !== 'node') {
    const Ctor = loadBetter();
    if (Ctor) return openBetter(Ctor, file);
    if (forced === 'better') throw new Error('better-sqlite3 could not be loaded');
  }
  return openNode(file);
}
