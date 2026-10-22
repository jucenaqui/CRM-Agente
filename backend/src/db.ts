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
  // 4: configurable pipeline (stages, lead sources, loss reasons), real close date, stage history
  `
  CREATE TABLE pipeline_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    probability INTEGER NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
    kind TEXT NOT NULL CHECK (kind IN ('open','won','lost')),
    color TEXT NOT NULL DEFAULT '#868e96',
    createdAt TEXT NOT NULL
  );
  INSERT INTO pipeline_stages (key, name, position, probability, kind, color, createdAt) VALUES
    ('lead',        'Lead',        1, 10,  'open', '#868e96', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('qualified',   'Calificado',  2, 25,  'open', '#1c7ed6', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('proposal',    'Propuesta',   3, 50,  'open', '#7048e8', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('negotiation', 'Negociación', 4, 75,  'open', '#f08c00', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('won',         'Ganado',      5, 100, 'won',  '#2f9e44', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('lost',        'Perdido',     6, 0,   'lost', '#e03131', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

  CREATE TABLE crm_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('lead_source','loss_reason')),
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    archivedAt TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_crm_options_name ON crm_options(kind, name COLLATE NOCASE) WHERE archivedAt IS NULL;
  INSERT INTO crm_options (kind, name, position, createdAt) VALUES
    ('lead_source', 'Web', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('lead_source', 'Recomendación', 2, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('lead_source', 'Redes sociales', 3, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('lead_source', 'Llamada en frío', 4, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('lead_source', 'Evento', 5, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('lead_source', 'Publicidad', 6, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('lead_source', 'Otro', 7, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('loss_reason', 'Precio', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('loss_reason', 'Eligió a la competencia', 2, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('loss_reason', 'Sin presupuesto', 3, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('loss_reason', 'Sin respuesta', 4, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('loss_reason', 'No era el momento', 5, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('loss_reason', 'Otro', 6, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

  -- deals: same table without the fixed list of stages, plus closedAt / sourceId / lostReasonId
  CREATE TABLE deals_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    stage TEXT NOT NULL DEFAULT 'lead',
    contactId INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    companyId INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    ownerId INTEGER NOT NULL REFERENCES users(id),
    expectedCloseDate TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    closedAt TEXT,
    sourceId INTEGER REFERENCES crm_options(id) ON DELETE SET NULL,
    lostReasonId INTEGER REFERENCES crm_options(id) ON DELETE SET NULL
  );
  INSERT INTO deals_new (id, title, value, currency, stage, contactId, companyId, ownerId, expectedCloseDate, createdAt, updatedAt, closedAt)
    SELECT id, title, value, currency, stage, contactId, companyId, ownerId, expectedCloseDate, createdAt, updatedAt,
           CASE WHEN stage IN ('won','lost') THEN updatedAt END
    FROM deals;
  DROP TABLE deals;
  ALTER TABLE deals_new RENAME TO deals;
  CREATE INDEX idx_deals_owner ON deals(ownerId);
  CREATE INDEX idx_deals_stage ON deals(stage);
  CREATE INDEX idx_deals_closed ON deals(closedAt);

  CREATE TABLE deal_stage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealId INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    fromStage TEXT,
    toStage TEXT NOT NULL,
    changedAt TEXT NOT NULL,
    changedBy INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX idx_stage_history_deal ON deal_stage_history(dealId);
  CREATE INDEX idx_stage_history_changed ON deal_stage_history(changedAt);
  -- existing deals: the only thing known is their current stage, reached (at the latest) when they were created
  INSERT INTO deal_stage_history (dealId, fromStage, toStage, changedAt, changedBy)
    SELECT id, NULL, stage, createdAt, ownerId FROM deals;

  ALTER TABLE activities ADD COLUMN completedAt TEXT;
  UPDATE activities SET completedAt = createdAt WHERE completed = 1;
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
  // Migrations rebuild tables (SQLite cannot drop a CHECK), which is only safe with foreign keys off;
  // the pragma cannot be changed inside a transaction, so it is switched around the whole run.
  db.exec('PRAGMA foreign_keys = OFF');
  migrate(db);
  db.exec('PRAGMA foreign_keys = ON');
  const broken = db.prepare('PRAGMA foreign_key_check').all();
  if (broken.length > 0) throw new Error(`Database integrity check failed after migration: ${JSON.stringify(broken.slice(0, 3))}`);
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
