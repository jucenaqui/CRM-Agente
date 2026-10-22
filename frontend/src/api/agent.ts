import { ApiError, getToken, request } from './client';
import type { ApiErrorBody } from './types';

export interface AgentModelInfo {
  id: string;
  label: string;
  description: string;
  inputPrice: number;
  outputPrice: number;
}

export interface AgentModelsResponse {
  configured: boolean;
  keySource: 'customer' | 'provider' | null;
  defaultModel: string | null;
  models: AgentModelInfo[];
}

export interface ConversationSummary {
  id: number;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; label: string; ok: boolean | null }
  /** Sólo en el cliente: confirmación de un borrado que pidió el asistente. */
  | { kind: 'confirm'; callId: string; label: string; status: 'pending' | 'approved' | 'denied' | 'expired' };

export interface ConversationDetail extends ConversationSummary {
  items: TranscriptItem[];
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
}

/** Eventos SSE de POST /api/agent/chat (ver backend/src/agent/loop.ts). */
export type AgentEvent =
  | { type: 'conversation'; id: number; title: string; model: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; label: string }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; changed?: string }
  | { type: 'confirm_required'; callId: string; label: string }
  | { type: 'confirm_resolved'; callId: string; decision: 'approved' | 'denied' | 'expired' }
  | { type: 'notice'; code: string; message: string }
  | { type: 'done'; usage: TurnUsage }
  | { type: 'error'; code: string; message: string };

export type KeyPolicy = 'default' | 'provider_only' | 'customer_only' | 'customer_then_provider';
export type CustomerKeyStatus = 'unverified' | 'ok' | 'exhausted' | 'invalid';

export interface AgentSettings {
  policy: KeyPolicy;
  providerKeyConfigured: boolean;
  customerKey: { configured: boolean; last4: string | null; status: CustomerKeyStatus | null; statusAt: string | null };
  effectiveSource: 'customer' | 'provider' | null;
  fallback: { enabled: boolean; capUsd: number; spentUsd: number; capReached: boolean };
}

export interface UsageReport {
  month: string;
  totals: { source: 'customer' | 'provider'; viaFallback: boolean; messages: number; inputTokens: number; outputTokens: number; costUsd: number }[];
  byUser: { userId: number | null; name: string | null; source: 'customer' | 'provider'; viaFallback: boolean; costUsd: number; steps: number }[];
}

export interface ApiToken {
  id: number;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export const agentApi = {
  settings: () => request<AgentSettings>('/agent/settings'),
  saveCustomerKey: (apiKey: string) =>
    request<AgentSettings['customerKey']>('/agent/settings/customer-key', { method: 'PUT', body: { apiKey } }),
  removeCustomerKey: () => request<void>('/agent/settings/customer-key', { method: 'DELETE' }),
  usage: (month?: string) => request<UsageReport>('/agent/usage', { query: { month } }),
  tokens: () => request<{ data: ApiToken[] }>('/tokens'),
  createToken: (name: string) => request<ApiToken & { token: string }>('/tokens', { method: 'POST', body: { name } }),
  revokeToken: (id: number) => request<void>(`/tokens/${id}`, { method: 'DELETE' }),
  models: () => request<AgentModelsResponse>('/agent/models'),
  conversations: () => request<{ data: ConversationSummary[] }>('/agent/conversations'),
  conversation: (id: number) => request<ConversationDetail>(`/agent/conversations/${id}`),
  removeConversation: (id: number) => request<void>(`/agent/conversations/${id}`, { method: 'DELETE' }),
  /** Respuesta de la persona a una confirmación de borrado pendiente. */
  confirm: (callId: string, approve: boolean) =>
    request<void>('/agent/chat/confirm', { method: 'POST', body: { callId, approve } }),
};

export interface ChatInput {
  message: string;
  model: string;
  conversationId?: number;
}

/**
 * Envía un mensaje al asistente y entrega cada evento según llega (streaming SSE).
 * Los errores previos al streaming (503 sin configurar, 409 ocupado, 429...) se lanzan como ApiError.
 */
export async function streamChat(input: ChatInput, onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch('/api/agent/chat', { method: 'POST', headers, body: JSON.stringify(input), signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor');
  }

  if (!res.ok || !res.body) {
    let body: Partial<ApiErrorBody> | undefined;
    try {
      body = (await res.json()) as Partial<ApiErrorBody>;
    } catch {
      body = undefined;
    }
    throw new ApiError(
      res.status,
      body?.error?.code ?? `HTTP_${res.status}`,
      body?.error?.message ?? `Error ${res.status}`,
      body?.error?.details,
    );
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          onEvent(JSON.parse(line.slice(6)) as AgentEvent);
        } catch {
          /* línea malformada: se ignora */
        }
      }
    }
  }
}

/** Avisa a las pantallas abiertas de que el asistente cambió datos del CRM. */
export const DATA_CHANGED_EVENT = 'crm:data-changed';

export function notifyDataChanged(entity?: string): void {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { entity } }));
}
