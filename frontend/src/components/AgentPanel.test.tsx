import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DATA_CHANGED_EVENT } from '../api/agent';
import { setToken } from '../api/client';
import { adminUser, emptyStats, jsonResponse, mockFetch, renderApp } from '../test/utils';

const models = {
  configured: true,
  defaultModel: 'claude-opus-5-5',
  models: [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: 'Recomendado', inputPrice: 4, outputPrice: 20 },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', description: 'Barato', inputPrice: 0.1, outputPrice: 0.5 },
  ],
};

function sse(events: unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const e of events) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function baseRoutes(extra: Parameters<typeof mockFetch>[0] = {}) {
  setToken('tok');
  return mockFetch({
    'GET /api/auth/me': () => jsonResponse(adminUser),
    'GET /api/dashboard/stats': () => jsonResponse(emptyStats),
    'GET /api/agent/models': () => jsonResponse(models),
    ...extra,
  });
}

describe('AgentPanel', () => {
  it('does not call the agent API until opened', async () => {
    const spy = baseRoutes();
    renderApp('/');
    await screen.findByRole('button', { name: /abrir asistente/i });
    expect(spy.mock.calls.some(([u]) => String(u).includes('/agent/'))).toBe(false);
  });

  it('streams the answer, shows tool progress, sends the chosen model and refreshes data', async () => {
    let sentBody: Record<string, unknown> | undefined;
    baseRoutes({
      'POST /api/agent/chat': (_url, init) => {
        sentBody = JSON.parse(String(init.body));
        return sse([
          { type: 'conversation', id: 7, title: 'Crea Acme', model: 'claude-haiku-5-5' },
          { type: 'text', delta: 'Creando ' },
          { type: 'tool_start', id: 't1', name: 'create_company', label: 'Creando company' },
          { type: 'tool_end', id: 't1', name: 'create_company', ok: true, changed: 'companies' },
          { type: 'text', delta: 'listo.' },
          { type: 'done', usage: { inputTokens: 900, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0.0001 } },
        ]);
      },
    });
    const changed = vi.fn();
    window.addEventListener(DATA_CHANGED_EVENT, changed);

    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: /abrir asistente/i }));
    const select = await screen.findByLabelText('Modelo');
    await user.selectOptions(select, 'claude-haiku-5-5');
    await user.type(screen.getByLabelText(/mensaje para el asistente/i), 'Crea Acme{Enter}');

    expect(await screen.findByText('Crea Acme')).toBeInTheDocument();
    expect(await screen.findByText(/listo\./)).toBeInTheDocument();
    expect(screen.getByText(/Creando company/)).toBeInTheDocument();
    expect(await screen.findByText(/coste estimado/)).toBeInTheDocument();
    expect(sentBody).toEqual({ message: 'Crea Acme', model: 'claude-haiku-5-5' });
    expect(changed).toHaveBeenCalled();
    expect(window.localStorage.getItem('newcrm.agentModel')).toBe('claude-haiku-5-5');
    window.removeEventListener(DATA_CHANGED_EVENT, changed);
  });

  it('continues the same conversation on the next message', async () => {
    const bodies: Record<string, unknown>[] = [];
    baseRoutes({
      'POST /api/agent/chat': (_url, init) => {
        bodies.push(JSON.parse(String(init.body)));
        return sse([
          { type: 'conversation', id: 42, title: 't', model: 'claude-opus-5-5' },
          { type: 'text', delta: `respuesta ${bodies.length}` },
          { type: 'done', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0 } },
        ]);
      },
    });
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: /abrir asistente/i }));
    await screen.findByLabelText('Modelo');
    const box = screen.getByLabelText(/mensaje para el asistente/i);
    await user.type(box, 'uno{Enter}');
    await screen.findByText('respuesta 1');
    await user.type(box, 'dos{Enter}');
    await screen.findByText('respuesta 2');
    expect(bodies[1]).toEqual({ message: 'dos', model: 'claude-opus-5-5', conversationId: 42 });
  });

  it('tells the user when the provider key takes over, and who pays', async () => {
    baseRoutes({
      'GET /api/agent/models': () => jsonResponse({ ...models, keySource: 'customer' }),
      'POST /api/agent/chat': () =>
        sse([
          { type: 'conversation', id: 1, title: 't', model: 'claude-opus-5-5' },
          { type: 'notice', code: 'KEY_FALLBACK', message: 'Tu clave de Anthropic no tiene saldo; se está usando la clave del proveedor del CRM.' },
          { type: 'text', delta: 'hecho' },
          { type: 'done', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0 } },
        ]),
    });
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: /abrir asistente/i }));
    expect(await screen.findByText(/usa tu clave de anthropic/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/mensaje para el asistente/i), 'hola{Enter}');
    expect(await screen.findByText(/se está usando la clave del proveedor/i)).toBeInTheDocument();
    expect(await screen.findByText('hecho')).toBeInTheDocument();
  });

  it('refreshes who pays every time it is opened (e.g. after saving a key in Settings)', async () => {
    let source: 'provider' | 'customer' = 'provider';
    baseRoutes({ 'GET /api/agent/models': () => jsonResponse({ ...models, keySource: source }) });
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: /abrir asistente/i }));
    expect(await screen.findByText(/usa la clave del proveedor/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cerrar asistente/i }));
    source = 'customer';
    await user.click(await screen.findByRole('button', { name: /abrir asistente/i }));
    expect(await screen.findByText(/usa tu clave de anthropic/i)).toBeInTheDocument();
  });

  it('asks before deleting: shows what will be deleted, waits for the button and sends the answer', async () => {
    const enc = new TextEncoder();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const push = (e: unknown) => stream.enqueue(enc.encode(`data: ${JSON.stringify(e)}

`));
    let answer: Record<string, unknown> | undefined;
    baseRoutes({
      'POST /api/agent/chat': () =>
        new Response(new ReadableStream<Uint8Array>({ start: (c) => { stream = c; } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      'POST /api/agent/chat/confirm': (_u, init) => {
        answer = JSON.parse(String(init.body));
        push({ type: 'confirm_resolved', callId: 'tu_1', decision: 'approved' });
        push({ type: 'tool_end', id: 'tu_1', name: 'delete_record', ok: true, changed: 'companies' });
        push({ type: 'text', delta: 'Borrada.' });
        push({ type: 'done', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0 } });
        stream.close();
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: /abrir asistente/i }));
    await screen.findByLabelText('Modelo');
    await user.type(screen.getByLabelText(/mensaje para el asistente/i), 'borra Acme{Enter}');
    await waitFor(() => expect(stream).toBeDefined());
    push({ type: 'conversation', id: 3, title: 't', model: 'claude-opus-5-5' });
    push({ type: 'tool_start', id: 'tu_1', name: 'delete_record', label: 'Borrando un registro' });
    push({ type: 'confirm_required', callId: 'tu_1', label: 'empresa «Acme» (id 4)' });

    const box = await screen.findByRole('group', { name: /confirmar borrado/i });
    expect(within(box).getByText('empresa «Acme» (id 4)')).toBeInTheDocument();
    expect(within(box).getByText(/no se puede deshacer/i)).toBeInTheDocument();
    expect(answer).toBeUndefined(); // nothing is sent until the person decides

    await user.click(within(box).getByRole('button', { name: 'Borrar' }));
    expect(await screen.findByText('Borrada.')).toBeInTheDocument();
    expect(answer).toEqual({ callId: 'tu_1', approve: true });
    expect(screen.getByText(/borrado confirmado/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Borrar' })).not.toBeInTheDocument(); // buttons disappear once answered
  });

  it('sends approve:false when the person cancels', async () => {
    const enc = new TextEncoder();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const push = (e: unknown) => stream.enqueue(enc.encode(`data: ${JSON.stringify(e)}

`));
    let answer: Record<string, unknown> | undefined;
    baseRoutes({
      'POST /api/agent/chat': () =>
        new Response(new ReadableStream<Uint8Array>({ start: (c) => { stream = c; } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      'POST /api/agent/chat/confirm': (_u, init) => {
        answer = JSON.parse(String(init.body));
        push({ type: 'confirm_resolved', callId: 'tu_2', decision: 'denied' });
        push({ type: 'done', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0 } });
        stream.close();
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: /abrir asistente/i }));
    await screen.findByLabelText('Modelo');
    await user.type(screen.getByLabelText(/mensaje para el asistente/i), 'borra Acme{Enter}');
    await waitFor(() => expect(stream).toBeDefined());
    push({ type: 'confirm_required', callId: 'tu_2', label: 'contacto «Juan Pérez» (id 1)' });
    await user.click(within(await screen.findByRole('group', { name: /confirmar borrado/i })).getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText(/borrado cancelado/i)).toBeInTheDocument();
    expect(answer).toEqual({ callId: 'tu_2', approve: false });
  });

  it('explains when the server has no Anthropic key', async () => {
    baseRoutes({ 'GET /api/agent/models': () => jsonResponse({ ...models, configured: false }) });
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: /abrir asistente/i }));
    expect(await screen.findByText(/no está configurado/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/mensaje para el asistente/i)).toBeDisabled();
  });

  it('shows API errors returned before streaming starts', async () => {
    baseRoutes({
      'POST /api/agent/chat': () =>
        jsonResponse({ error: { code: 'RATE_LIMITED', message: 'Demasiados mensajes al asistente' } }, 429),
    });
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: /abrir asistente/i }));
    await screen.findByLabelText('Modelo');
    await user.type(screen.getByLabelText(/mensaje para el asistente/i), 'hola{Enter}');
    expect(await screen.findByText('Demasiados mensajes al asistente')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument());
  });
});
