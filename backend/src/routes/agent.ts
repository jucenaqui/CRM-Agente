import Anthropic from '@anthropic-ai/sdk';
import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { decide } from '../agent/confirm.js';
import { CONTEXT_TAG, runAgentTurn, type AgentEvent } from '../agent/loop.js';
import {
  customerKeyInfo,
  fallbackCapReached,
  fallbackSpentUsd,
  getFallbackCapUsd,
  getPolicy,
  getProviderKey,
  recordUsage,
  removeCustomerKey,
  resolveKeys,
  saveCustomerKey,
  setCustomerKeyStatus,
  usageReport,
} from '../agent/keys.js';
import { validateAnthropicKey } from '../agent/llm.js';
import { defaultModel, enabledModels, findEnabledModel } from '../agent/models.js';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  type AgentMessage,
} from '../agent/store.js';
import { describeTool } from '../agent/tools.js';
import { currentUser, requireRole } from '../lib/auth.js';
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
  const keys = resolveKeys();
  res.json({
    configured: keys.length > 0,
    keySource: keys[0]?.source ?? null,
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

  const keys = resolveKeys();
  if (keys.length === 0) {
    throw new HttpError(
      503,
      'AGENT_NOT_CONFIGURED',
      getPolicy() === 'customer_only'
        ? 'El asistente no está configurado: un administrador debe guardar la clave de Anthropic en Ajustes.'
        : 'El asistente no está configurado: falta la clave de Anthropic (ANTHROPIC_API_KEY en el servidor, o una clave guardada en Ajustes).',
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
  const gone = new AbortController();
  res.on('close', () => gone.abort());
  const emit = (event: AgentEvent) => {
    if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    emit({ type: 'conversation', id: conversation.id, title: conversation.title, model: model.id });
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    await runAgentTurn({
      conversation,
      userText: body.message,
      model,
      user,
      token,
      keys,
      emit,
      signal: gone.signal,
      onSpend: (entry) => recordUsage(entry, { userId: user.id, conversationId: conversation.id, model: model.id }),
      onKeyFailure: (key, reason) => {
        if (key.source === 'customer') setCustomerKeyStatus(reason);
      },
      onKeySuccess: (key) => {
        if (key.source === 'customer') setCustomerKeyStatus('ok');
      },
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') console.error(err);
    emit({ type: 'error', code: 'AGENT_ERROR', message: 'Error inesperado del asistente.' });
  } finally {
    busy.delete(conversation.id);
    res.end();
  }
});

/** Anthropic's own explanation of an error, with anything that looks like a key redacted. */
function anthropicReason(err: unknown): string {
  const body = (err as { error?: { error?: { message?: unknown } } }).error?.error?.message;
  const raw = typeof body === 'string' ? body : err instanceof Error ? err.message : 'sin detalle';
  return raw.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…').slice(0, 300);
}

// ---- Anthropic key settings & usage (admins) ----

const adminOnly = requireRole('admin');

router.get('/settings', adminOnly, (_req, res) => {
  const keys = resolveKeys();
  const capUsd = getFallbackCapUsd();
  res.json({
    policy: getPolicy(),
    providerKeyConfigured: !!getProviderKey(),
    customerKey: customerKeyInfo(),
    effectiveSource: keys[0]?.source ?? null,
    fallback: {
      enabled: keys.some((k) => k.viaFallback),
      capUsd,
      spentUsd: fallbackSpentUsd(),
      capReached: fallbackCapReached(),
    },
  });
});

const keySchema = z.strictObject({ apiKey: z.string().trim().regex(/^sk-ant-[A-Za-z0-9_-]{20,}$/, 'No parece una clave de Anthropic (sk-ant-…)') });

router.put('/settings/customer-key', adminOnly, async (req, res) => {
  const { apiKey } = validate(keySchema, req.body ?? {});
  if (getPolicy() === 'provider_only') {
    throw conflict('Este servicio usa siempre la clave del proveedor; no se puede guardar otra.', 'CUSTOMER_KEY_DISABLED');
  }
  try {
    await validateAnthropicKey(apiKey);
  } catch (err) {
    // Log what Anthropic answered (status/type only, never the key) so a failure can be diagnosed.
    const reason = anthropicReason(err);
    if (process.env.NODE_ENV !== 'test') {
      const e = err as { status?: number; type?: string };
      console.error(`customer-key check failed: status=${e.status ?? '-'} type=${e.type ?? '-'} reason=${reason}`);
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw badRequest('Anthropic rechazó la clave: no es válida o no tiene permisos.');
    }
    if (/workspace/i.test(reason)) {
      throw badRequest(
        'Esta clave no está asociada a un workspace de Anthropic. Créala dentro de un workspace (console.anthropic.com → Workspaces → API keys) y vuelve a pegarla.',
      );
    }
    // Any other 4xx (except rate limiting) is also Anthropic refusing this key/request.
    if (err instanceof Anthropic.APIError && err.status !== undefined && err.status >= 400 && err.status < 500 && err.status !== 429) {
      throw badRequest(`Anthropic rechazó la comprobación de la clave (error ${err.status}): ${reason}`);
    }
    const status = err instanceof Anthropic.APIError && err.status ? ` (error ${err.status})` : '';
    throw new HttpError(503, 'ANTHROPIC_UNREACHABLE', `No se pudo comprobar la clave con Anthropic${status}. Inténtalo de nuevo.`);
  }
  saveCustomerKey(apiKey);
  res.json(customerKeyInfo());
});

router.delete('/settings/customer-key', adminOnly, (_req, res) => {
  removeCustomerKey();
  res.status(204).end();
});

router.get('/usage', adminOnly, (req, res) => {
  const month = typeof req.query.month === 'string' ? req.query.month : undefined;
  res.json(usageReport(month));
});

const confirmSchema = z.strictObject({ callId: z.string().min(1).max(200), approve: z.boolean() });

/** The person's answer to a `confirm_required` event (see agent/confirm.ts). */
router.post('/chat/confirm', (req, res) => {
  const { callId, approve } = validate(confirmSchema, req.body ?? {});
  if (!decide(currentUser(req).id, callId, approve)) throw notFound('No hay ninguna confirmación pendiente');
  res.status(204).end();
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
