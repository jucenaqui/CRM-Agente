import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  agentApi,
  notifyDataChanged,
  streamChat,
  type AgentEvent,
  type AgentModelsResponse,
  type ConversationSummary,
  type TranscriptItem,
  type TurnUsage,
} from '../api/agent';
import { errorMessage } from '../api/client';

const MODEL_KEY = 'newcrm.agentModel';

const SUGGESTIONS = [
  '¿Cómo va mi embudo de ventas?',
  'Crea la empresa Acme con web acme.com',
  '¿Qué actividades tengo pendientes esta semana?',
];

function readStoredModel(): string | null {
  try {
    return window.localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

function storeModel(id: string): void {
  try {
    window.localStorage.setItem(MODEL_KEY, id);
  } catch {
    /* preferencia sólo en memoria */
  }
}

const formatCost = (usd: number) => (usd < 0.01 ? '< $0.01' : `$${usd.toFixed(2)}`);

export function AgentPanel() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<AgentModelsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [model, setModel] = useState<string>('');
  const [conversationId, setConversationId] = useState<number | undefined>();
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [usage, setUsage] = useState<TurnUsage | null>(null);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Modelos y quién paga se piden cada vez que se abre el panel: un admin puede haber cambiado
  // la clave en Ajustes desde la última vez.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    agentApi
      .models()
      .then((r) => {
        if (!alive) return;
        setInfo(r);
        setLoadError(null);
        // Se conserva el modelo ya elegido mientras siga disponible.
        setModel((current) => {
          if (r.models.some((m) => m.id === current)) return current;
          const stored = readStoredModel();
          return r.models.some((m) => m.id === stored) ? stored! : (r.defaultModel ?? r.models[0]?.id ?? '');
        });
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, history]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [items, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const chooseModel = (id: string) => {
    setModel(id);
    storeModel(id);
  };

  const newConversation = () => {
    setConversationId(undefined);
    setItems([]);
    setUsage(null);
    setError(null);
    setHistory(null);
  };

  const showHistory = async () => {
    try {
      setHistory((await agentApi.conversations()).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const openConversation = async (id: number) => {
    try {
      const c = await agentApi.conversation(id);
      setConversationId(c.id);
      setItems(c.items);
      if (info?.models.some((m) => m.id === c.model)) setModel(c.model);
      setUsage(null);
      setError(null);
      setHistory(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const removeConversation = async (id: number) => {
    try {
      await agentApi.removeConversation(id);
      setHistory((h) => h?.filter((c) => c.id !== id) ?? null);
      if (id === conversationId) newConversation();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const onEvent = useCallback((e: AgentEvent) => {
    switch (e.type) {
      case 'conversation':
        setConversationId(e.id);
        break;
      case 'text':
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last?.kind === 'assistant') return [...prev.slice(0, -1), { ...last, text: last.text + e.delta }];
          return [...prev, { kind: 'assistant', text: e.delta }];
        });
        break;
      case 'tool_start':
        setItems((prev) => [...prev, { kind: 'tool', id: e.id, name: e.name, label: e.label, ok: null }]);
        break;
      case 'tool_end':
        setItems((prev) => prev.map((it) => (it.kind === 'tool' && it.id === e.id ? { ...it, ok: e.ok } : it)));
        if (e.changed) notifyDataChanged(e.changed);
        break;
      case 'confirm_required':
        setItems((prev) => [...prev, { kind: 'confirm', callId: e.callId, label: e.label, status: 'pending' }]);
        break;
      case 'confirm_resolved':
        setItems((prev) => prev.map((it) => (it.kind === 'confirm' && it.callId === e.callId ? { ...it, status: e.decision } : it)));
        break;
      case 'notice':
        setNotice(e.message);
        break;
      case 'done':
        setUsage(e.usage);
        break;
      case 'error':
        setError(e.message);
        break;
    }
  }, []);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || !model) return;
    setInput('');
    setError(null);
    setNotice(null);
    setUsage(null);
    setItems((prev) => [...prev, { kind: 'user', text: message }]);
    setBusy(true);
    try {
      await streamChat({ message, model, conversationId }, onEvent);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const answerConfirm = async (callId: string, approve: boolean) => {
    try {
      await agentApi.confirm(callId, approve);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const current = info?.models.find((m) => m.id === model);
  const notConfigured = info && !info.configured;
  const paidBy =
    info?.keySource === 'customer' ? 'Usa tu clave de Anthropic' : info?.keySource === 'provider' ? 'Usa la clave del proveedor' : null;

  if (!open) {
    return (
      <button type="button" className="agent-launcher" onClick={() => setOpen(true)} aria-label="Abrir asistente IA">
        <span aria-hidden="true">✦</span> Asistente
      </button>
    );
  }

  return (
    <aside className="agent-panel" role="dialog" aria-label="Asistente IA">
      <header className="agent-header">
        <strong>Asistente IA</strong>
        <div className="agent-header-actions">
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => void showHistory()} disabled={busy}>
            Historial
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={newConversation} disabled={busy}>
            Nueva
          </button>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Cerrar asistente">
            ×
          </button>
        </div>
      </header>

      {info && info.models.length > 0 && (
        <div className="agent-model">
          <label htmlFor="agent-model">Modelo</label>
          <select id="agent-model" value={model} onChange={(e) => chooseModel(e.target.value)} disabled={busy}>
            {info.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {current && (
            <p className="agent-model-desc">
              {current.description} · ${current.inputPrice} / ${current.outputPrice} por millón de tokens (entrada / salida)
              {paidBy ? ` · ${paidBy}` : ''}
            </p>
          )}
        </div>
      )}

      <div className="agent-body">
        {loadError && <div className="alert alert-error">{loadError}</div>}
        {notConfigured && (
          <div className="alert alert-info">
            El asistente no está configurado. Añade <code>ANTHROPIC_API_KEY</code> en <code>backend/.env</code> y reinicia el
            servidor.
          </div>
        )}

        {history ? (
          <div className="agent-history">
            <div className="agent-history-head">
              <span>Conversaciones</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setHistory(null)}>
                Volver
              </button>
            </div>
            {history.length === 0 && <p className="muted">Todavía no hay conversaciones.</p>}
            <ul>
              {history.map((c) => (
                <li key={c.id}>
                  <button type="button" className="agent-history-item" onClick={() => void openConversation(c.id)}>
                    <span>{c.title}</span>
                    <small>{new Date(c.updatedAt).toLocaleString()}</small>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Borrar conversación ${c.title}`}
                    onClick={() => void removeConversation(c.id)}
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="agent-messages" aria-live="polite">
            {items.length === 0 && !notConfigured && (
              <div className="agent-empty">
                <p>Pídeme lo que harías en el CRM: buscar, crear, editar, mover o borrar registros.</p>
                <div className="agent-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="btn btn-secondary btn-xs" onClick={() => void send(s)} disabled={busy || !model}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {items.map((it, i) =>
              it.kind === 'confirm' ? (
                <div key={`confirm-${it.callId}`} className={`agent-confirm ${it.status}`} role="group" aria-label="Confirmar borrado">
                  <p>
                    {it.status === 'pending' ? '¿Borrar ' : it.status === 'approved' ? 'Borrado confirmado: ' : it.status === 'denied' ? 'Borrado cancelado: ' : 'Sin respuesta, no se borró: '}
                    <strong>{it.label}</strong>
                    {it.status === 'pending' ? '? Esta acción no se puede deshacer.' : ''}
                  </p>
                  {it.status === 'pending' && (
                    <div className="agent-confirm-actions">
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => void answerConfirm(it.callId, true)}>
                        Borrar
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void answerConfirm(it.callId, false)}>
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              ) : it.kind === 'tool' ? (
                <div key={`${it.id}-${i}`} className={`agent-tool ${it.ok === null ? 'running' : it.ok ? 'ok' : 'fail'}`}>
                  <span aria-hidden="true">{it.ok === null ? '⋯' : it.ok ? '✓' : '✕'}</span> {it.label}
                </div>
              ) : (
                <div key={i} className={`agent-msg ${it.kind}`}>
                  {it.text}
                </div>
              ),
            )}
            {busy && items[items.length - 1]?.kind !== 'assistant' && !(items[items.length - 1]?.kind === 'confirm' && (items[items.length - 1] as { status: string }).status === 'pending') && (
              <div className="agent-msg assistant thinking" aria-label="El asistente está trabajando">
                Pensando…
              </div>
            )}
            {notice && <div className="alert alert-info">{notice}</div>}
            {error && <div className="alert alert-error">{error}</div>}
            {usage && (
              <p className="agent-usage">
                {usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens} tokens de entrada · {usage.outputTokens} de
                salida · coste estimado {formatCost(usage.estimatedCostUsd)}
              </p>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form className="agent-input" onSubmit={onSubmit}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribe una instrucción… (Enter para enviar, Mayús+Enter para salto de línea)"
          rows={2}
          maxLength={8000}
          disabled={busy || !!notConfigured || !model}
          aria-label="Mensaje para el asistente"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim() || !model}>
          {busy ? 'Trabajando…' : 'Enviar'}
        </button>
      </form>
    </aside>
  );
}
