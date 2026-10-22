import type Anthropic from '@anthropic-ai/sdk';
import { getDb, nowIso } from '../db.js';

export type AgentMessage = Anthropic.Beta.BetaMessageParam;

export interface Conversation {
  id: number;
  title: string;
  model: string;
  messages: AgentMessage[];
  ownerId: number;
  createdAt: string;
  updatedAt: string;
}

interface ConversationRow extends Omit<Conversation, 'messages'> {
  messages: string;
}

export interface ConversationSummary {
  id: number;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

const parse = (row: ConversationRow): Conversation => ({ ...row, messages: JSON.parse(row.messages) });

export function createConversation(ownerId: number, model: string, title: string): Conversation {
  const now = nowIso();
  const info = getDb()
    .prepare(
      'INSERT INTO agent_conversations (title, model, messages, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(title, model, '[]', ownerId, now, now);
  return getConversation(Number(info.lastInsertRowid), ownerId)!;
}

/** Only the owner can read a conversation (others get undefined → 404). */
export function getConversation(id: number, ownerId: number): Conversation | undefined {
  const row = getDb()
    .prepare('SELECT * FROM agent_conversations WHERE id = ? AND ownerId = ?')
    .get(id, ownerId) as ConversationRow | undefined;
  return row ? parse(row) : undefined;
}

export function listConversations(ownerId: number, limit = 50): ConversationSummary[] {
  return getDb()
    .prepare(
      'SELECT id, title, model, createdAt, updatedAt FROM agent_conversations WHERE ownerId = ? ORDER BY updatedAt DESC, id DESC LIMIT ?',
    )
    .all(ownerId, limit) as ConversationSummary[];
}

/**
 * Persists the whole history. Callers only ever append to it: earlier messages are
 * never edited, so replayed thinking blocks stay valid and the prompt cache keeps hitting.
 */
export function saveMessages(id: number, messages: AgentMessage[], model: string): void {
  getDb()
    .prepare('UPDATE agent_conversations SET messages = ?, model = ?, updatedAt = ? WHERE id = ?')
    .run(JSON.stringify(messages), model, nowIso(), id);
}

export function deleteConversation(id: number, ownerId: number): boolean {
  const info = getDb().prepare('DELETE FROM agent_conversations WHERE id = ? AND ownerId = ?').run(id, ownerId);
  return info.changes > 0;
}
