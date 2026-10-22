import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getDb, nowIso } from '../db.js';
import { currentUser } from '../lib/auth.js';
import { parseIdParam } from '../lib/crud.js';
import { conflict, notFound } from '../lib/errors.js';
import { reqText, validate } from '../lib/validation.js';

/**
 * Personal access tokens for MCP clients (Claude Code, Claude Desktop...). A token acts as
 * its owner but is accepted only by /api/mcp, never by the regular API. Only a SHA-256 hash
 * is stored; the plain token is shown once, when it is created.
 */
export const TOKEN_PREFIX = 'ncrm_';
const MAX_ACTIVE_TOKENS = 10;

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

interface TokenRow {
  id: number;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const router = Router();

router.get('/', (req, res) => {
  const rows = getDb()
    .prepare(
      'SELECT id, name, tokenPrefix, createdAt, lastUsedAt FROM api_tokens WHERE userId = ? AND revokedAt IS NULL ORDER BY id DESC',
    )
    .all(currentUser(req).id) as TokenRow[];
  res.json({ data: rows });
});

const createSchema = z.strictObject({ name: reqText(80) });

router.post('/', (req, res) => {
  const user = currentUser(req);
  const { name } = validate(createSchema, req.body ?? {});
  const db = getDb();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE userId = ? AND revokedAt IS NULL').get(user.id) as {
    n: number;
  };
  if (n >= MAX_ACTIVE_TOKENS) {
    throw conflict(`Ya tienes ${MAX_ACTIVE_TOKENS} tokens activos; revoca alguno antes de crear otro.`, 'TOKEN_LIMIT');
  }
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const tokenPrefix = token.slice(0, TOKEN_PREFIX.length + 4);
  const now = nowIso();
  const info = db
    .prepare('INSERT INTO api_tokens (userId, name, tokenHash, tokenPrefix, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, name, hashToken(token), tokenPrefix, now);
  res.status(201).json({ id: Number(info.lastInsertRowid), name, tokenPrefix, createdAt: now, lastUsedAt: null, token });
});

router.delete('/:id', (req, res) => {
  const id = parseIdParam(req.params.id);
  const info = getDb()
    .prepare('UPDATE api_tokens SET revokedAt = ? WHERE id = ? AND userId = ? AND revokedAt IS NULL')
    .run(nowIso(), id, currentUser(req).id);
  if (info.changes === 0) throw notFound('Token not found');
  res.status(204).end();
});

export default router;
