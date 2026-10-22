import type Anthropic from '@anthropic-ai/sdk';
import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { CONTEXT_TAG, runAgentTurn, type AgentEvent } from '../agent/loop.js';
import { isAgentConfigured } from '../agent/llm.js';
import { defaultModel, enabledModels, findEnabledModel } from '../agent/models.js';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  type AgentMessage,
} from '../agent/store.js';
import { describeTool } from '../agent/tools.js';
import { currentUser } from '../lib/auth.js';
import { parseIdParam } from '../lib/crud.js';
import { HttpError, badRequest, conflict, notFound } from '../lib/errors.js';
import { validate } from '../lib/validation.js';

const router = Router();

const rateLimitDisabled = () => process.env.NODE_ENV === 'test' || process.env.RATE_LIMIT_DISABLED === '1';

// Each chat turn costs money on the Anthropic account: limit per user, not per IP.
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AGENT_RATE_LIMIT_MAX ?? 60),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: rateLimitDisabled,
  keyGenerator: (req) => `user:${(req as Request).user?.id ?? 'anon'}`,
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Demasiados mensajes al asistente; inténtalo en unos minutos.' },
    });
  },
});

router.get('/models', (_req, res) => {
  res.json({
    configured: isAgentConfigured(),
    defaultModel: defaultModel()?.id ?? null,
    models: enabledModels().map(({ id, label, description, inputPrice, outputPrice }) => ({
      id,
      label,
      description,
      inputPrice,
      outputPrice,
    })),
  });
});

router.get('/conversations', (req, res) => {
  res.json({ data: listConversations(currentUser(req).id) });
});

router.get('/conversations/:id', (req, res) => {
  const conv = getConversation(parseIdParam(req.params.id), currentUser(req).id);
  if (!conv) throw notFound('Conversation not found');
  res.json({
    id: conv.id,
    title: conv.title,
    model: conv.model,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    items: toTranscript(conv.messages),
  });
});

router.delete('/conversations/:id', (req, res) => {
  if (!deleteConversation(parseIdParam(req.params.id), currentUser(req).id)) throw notFound('Conversation not found');
  res.status(204).end();
});

const chatSchema = z.strictObject({
  message: z.string().trim().min(1).max(8000),
  model: z.string().max(100).optional(),
  conversationId: z.number().int().positive().optional(),
});

/** In-flight turns, so two tabs cannot interleave writes into one conversation. */
const busy = new Set<number>();

router.post('/chat', chatLimiter, async (req, res) => {
  const user = currentUser(req);
  const body = validate(chatSchema, req.body ?? {});

  if (!isAgentConfigured()) {
    throw new HttpError(
      503,
      'AGENT_NOT_CONFIGURED',
      'El asistente no está configurado: falta ANTHROPIC_API_KEY en el servidor.',
    );
  }

  const existing = body.conversationId ? getConversation(body.conversationId, user.id) : undefined;
  if (body.conversationId && !existing) throw notFound('Conversation not found');

  const modelId = body.model ?? existing?.model ?? defaultModel()?.id;
  const model = modelId ? findEnabledModel(modelId) : undefined;
  if (!model) {
    throw badRequest('Modelo no permitido', { allowed: enabledModels().map((m) => m.id) });
  }

  const conversation = existing ?? createConversation(user.id, model.id, titleFrom(body.message));
  if (busy.has(conversation.id)) {
    throw conflict('El asistente ya está respondiendo en esta conversación', 'AGENT_BUSY');
  }
  busy.add(conversation.id);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // The turn runs to completion even if the browser disconnects, so the stored
  // history always ends on a consistent step.
  const emit = (event: AgentEvent) => {
    if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    emit({ type: 'conversation', id: conversation.id, title: conversation.title, model: model.id });
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    await runAgentTurn({ conversation, userText: body.message, model, user, token, emit });
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') console.error(err);
    emit({ type: 'error', code: 'AGENT_ERROR', message: 'Error inesperado del asistente.' });
  } finally {
    busy.delete(conversation.id);
    res.end();
  }
});

function titleFrom(message: string): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; label: string; ok: boolean | null };

/** Display-friendly view of the stored API history (drops context blocks and thinking). */
export function toTranscript(messages: AgentMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const toolIndex = new Map<string, number>();
  for (const msg of messages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const role = msg.role;
    const blocks: Anthropic.Beta.BetaContentBlockParam[] =
      typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : (msg.content ?? []);
    for (const b of blocks) {
      if (b.type === 'text') {
        if (role === 'user' && b.text.startsWith(CONTEXT_TAG)) continue;
        const last = items[items.length - 1];
        if (last && last.kind === role) last.text += `\n\n${b.text}`;
        else items.push({ kind: role, text: b.text });
      } else if (b.type === 'tool_use') {
        toolIndex.set(b.id, items.length);
        items.push({ kind: 'tool', id: b.id, name: b.name, label: describeTool(b.name), ok: null });
      } else if (b.type === 'tool_result') {
        const i = toolIndex.get(b.tool_use_id);
        const item = i !== undefined ? items[i] : undefined;
        if (item?.kind === 'tool') item.ok = !b.is_error;
      }
    }
  }
  return items;
}

export default router;
