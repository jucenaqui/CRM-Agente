import fs from 'node:fs';
import path from 'node:path';
import { getDbPath } from './config.js';
import { openSqlite, type SqliteDb } from './sqlite.js';

export type DB = SqliteDb;

const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','sales')),
    createdAt TEXT NOT NULL
  );
  CREATE TABLE companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    industry TEXT,
    website TEXT,
    phone TEXT,
    address TEXT,
    ownerId INTEGER NOT NULL REFERENCES users(id),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX idx_companies_owner ON companies(ownerId);
  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firstName TEXT NOT NULL,
    lastName TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    position TEXT,
    companyId INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    ownerId INTEGER NOT NULL REFERENCES users(id),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX idx_contacts_owner ON contacts(ownerId);
  CREATE INDEX idx_contacts_company ON contacts(companyId);
  CREATE TABLE deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    stage TEXT NOT NULL DEFAULT 'lead'
      CHECK (stage IN ('lead','qualified','proposal','negotiation','won','lost')),
    contactId INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    companyId INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    ownerId INTEGER NOT NULL REFERENCES users(id),
    expectedCloseDate TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX idx_deals_owner ON deals(ownerId);
  CREATE INDEX idx_deals_stage ON deals(stage);
  CREATE TABLE activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('call','email','meeting','task','note')),
    subject TEXT NOT NULL,
    description TEXT,
    dueDate TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    contactId INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    dealId INTEGER REFERENCES deals(id) ON DELETE SET NULL,
    ownerId INTEGER NOT NULL REFERENCES users(id),
    createdAt TEXT NOT NULL
  );
  CREATE INDEX idx_activities_owner ON activities(ownerId);
  CREATE INDEX idx_activities_due ON activities(dueDate);
  `,
  // 2: AI agent conversations (history is append-only, stored as Claude API messages JSON)
  `
  CREATE TABLE agent_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    messages TEXT NOT NULL DEFAULT '[]',
    ownerId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX idx_agent_conversations_owner ON agent_conversations(ownerId);
  `,
  // 3: AI agent keys/usage/MCP tokens
  `
  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE agent_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER REFERENCES users(id) ON DELETE SET NULL,
    conversationId INTEGER,
    model TEXT NOT NULL,
    keySource TEXT NOT NULL CHECK (keySource IN ('customer','provider')),
    viaFallback INTEGER NOT NULL DEFAULT 0,
    inputTokens INTEGER NOT NULL,
    outputTokens INTEGER NOT NULL,
    cacheReadTokens INTEGER NOT NULL,
    cacheWriteTokens INTEGER NOT NULL,
    costUsd REAL NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX idx_agent_usage_created ON agent_usage(createdAt);
  CREATE TABLE api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    tokenHash TEXT NOT NULL UNIQUE,
    tokenPrefix TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    lastUsedAt TEXT,
    revokedAt TEXT
  );
  CREATE INDEX idx_api_tokens_user ON api_tokens(userId);
  `,
];

export function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  const current = row.v ?? 0;
  const apply = db.transaction((version: number, sql: string) => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, appliedAt) VALUES (?, ?)').run(
      version,
      new Date().toISOString(),
    );
  });
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (version > current) apply(version, sql);
  });
}

export function openDb(file = getDbPath()): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openSqlite(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

let instance: DB | null = null;

/** Lazily opened singleton (path read from DB_PATH on first use). */
export function getDb(): DB {
  if (!instance) instance = openDb();
  return instance;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

export const nowIso = (): string => new Date().toISOString();
