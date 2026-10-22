import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { setToken } from '../api/client';
import type { PipelineOverview } from '../api/types';
import { pipelineOverview } from '../test/fixtures';
import { adminUser, jsonResponse, mockFetch, renderApp, salesUser } from '../test/utils';

const clone = (): PipelineOverview => structuredClone(pipelineOverview);

/** Stateful fake of the pipeline endpoints so the screen reloads what the "server" now holds. */
function setup(user: typeof adminUser | typeof salesUser = adminUser) {
  setToken('tok');
  const state = clone();
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  const log = (init: RequestInit, url: URL) =>
    calls.push({ method: String(init.method ?? 'GET'), url: url.pathname + url.search, body: init.body ? JSON.parse(String(init.body)) : null });
  const spy = mockFetch({
    'GET /api/auth/me': () => jsonResponse(user),
    'GET /api/agent/settings': () => jsonResponse({ policy: 'default', providerKeyConfigured: true, customerKey: { configured: false, last4: null, status: null, statusAt: null }, effectiveSource: 'provider', fallback: { enabled: false, capUsd: 10, spentUsd: 0, capReached: false } }),
    'GET /api/agent/usage': () => jsonResponse({ month: '2026-10', totals: [], byUser: [] }),
    'GET /api/tokens': () => jsonResponse({ data: [] }),
    'GET /api/pipeline': () => jsonResponse(state),
  });
  return { state, calls, spy, log };
}

const row = (name: string) => screen.getByTestId(`stage-${name}`);

describe('Pipeline settings (Ajustes → Embudo de ventas)', () => {
  it('is only for admins', async () => {
    setup(salesUser);
    renderApp('/settings');
    await screen.findByRole('heading', { name: /conexión con claude/i });
    expect(screen.queryByRole('heading', { name: 'Embudo de ventas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Orígenes de lead' })).not.toBeInTheDocument();
  });

  it('lists the stages in order with their type and probability', async () => {
    setup();
    renderApp('/settings');
    const list = await screen.findByRole('list', { name: 'Etapas' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(within(items[0]!).getByLabelText('Nombre de la etapa Lead')).toHaveValue('Lead');
    expect(within(items[3]!).getByLabelText('Probabilidad de cierre de Negociación')).toHaveValue(75);
    expect(within(items[4]!).getByLabelText('Tipo de Ganado')).toHaveValue('won');
    expect(within(items[4]!).getByText('100 %')).toBeInTheDocument(); // ganada: fija
    expect(within(items[5]!).queryByLabelText(/Probabilidad/)).not.toBeInTheDocument();
  });

  it('adds a stage with the chosen type', async () => {
    const { state, calls, log } = setup();
    mockFetch({
      'GET /api/auth/me': () => jsonResponse(adminUser),
      'GET /api/agent/settings': () => jsonResponse({ policy: 'default', providerKeyConfigured: true, customerKey: { configured: false, last4: null, status: null, statusAt: null }, effectiveSource: 'provider', fallback: { enabled: false, capUsd: 10, spentUsd: 0, capReached: false } }),
      'GET /api/agent/usage': () => jsonResponse({ month: '2026-10', totals: [], byUser: [] }),
      'GET /api/tokens': () => jsonResponse({ data: [] }),
      'GET /api/pipeline': () => jsonResponse(state),
      'POST /api/pipeline/stages': (url, init) => {
        log(init, url);
        const body = JSON.parse(String(init.body));
        state.stages.splice(4, 0, { id: 7, key: 'demo-agendada', name: body.name, position: 5, probability: 50, kind: body.kind, color: '#1baf7a' });
        return jsonResponse(state.stages[4], 201);
      },
    });
    const user = userEvent.setup();
    renderApp('/settings');
    await screen.findByRole('list', { name: 'Etapas' });
    await user.type(screen.getByLabelText('Nueva etapa'), 'Demo agendada');
    await user.click(screen.getByRole('button', { name: 'Añadir etapa' }));

    expect(await screen.findByLabelText('Nombre de la etapa Demo agendada')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Demo agendada', kind: 'open' });
    expect(screen.getByLabelText('Nueva etapa')).toHaveValue(''); // el formulario se limpia
  });

  it('renames a stage when you leave the field, and ignores an unchanged or empty name', async () => {
    const { state, calls, log } = setup();
    mockFetch({
      'GET /api/auth/me': () => jsonResponse(adminUser),
      'GET /api/agent/settings': () => jsonResponse({ policy: 'default', providerKeyConfigured: true, customerKey: { configured: false, last4: null, status: null, statusAt: null }, effectiveSource: 'provider', fallback: { enabled: false, capUsd: 10, spentUsd: 0, capReached: false } }),
      'GET /api/agent/usage': () => jsonResponse({ month: '2026-10', totals: [], byUser: [] }),
      'GET /api/tokens': () => jsonResponse({ data: [] }),
      'GET /api/pipeline': () => jsonResponse(state),
      'PATCH /api/pipeline/stages/2': (url, init) => {
        log(init, url);
        state.stages[1] = { ...state.stages[1]!, ...JSON.parse(String(init.body)) };
        return jsonResponse(state.stages[1]);
      },
    });
    const user = userEvent.setup();
    renderApp('/settings');
    const input = await screen.findByLabelText('Nombre de la etapa Calificado');
    await user.click(input);
    await user.tab(); // sin cambios → no hay petición
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

    await user.clear(input);
    await user.type(input, 'Cualificado');
    await user.tab();
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Cualificado' }));

    const again = await screen.findByLabelText('Nombre de la etapa Cualificado');
    await user.clear(again);
    await user.tab(); // vacío → vuelve al valor anterior
    expect(await screen.findByLabelText('Nombre de la etapa Cualificado')).toHaveValue('Cualificado');
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('changes the type and the probability of a stage', async () => {
    const { calls, spy } = setup();
    const base = spy.getMockImplementation()!;
    spy.mockImplementation(async (input, init = {}) => {
      const url = new URL(String(input), 'http://localhost');
      if ((init.method ?? 'GET') === 'PATCH') {
        calls.push({ method: 'PATCH', url: url.pathname, body: JSON.parse(String(init.body)) });
        return jsonResponse({ ...pipelineOverview.stages[0], ...JSON.parse(String(init.body)) });
      }
      return base(input, init);
    });
    const user = userEvent.setup();
    renderApp('/settings');
    const prob = await screen.findByLabelText('Probabilidad de cierre de Propuesta');
    await user.clear(prob);
    await user.type(prob, '60');
    await user.tab();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/pipeline/stages/3' && (c.body as { probability?: number }).probability === 60)).toBe(true));

    await user.selectOptions(screen.getByLabelText('Tipo de Lead'), 'lost');
    await waitFor(() => expect(calls.some((c) => c.url === '/api/pipeline/stages/1' && (c.body as { kind?: string }).kind === 'lost')).toBe(true));
  });

  it('reorders with the arrows by sending the whole new order', async () => {
    const { calls, spy } = setup();
    const base = spy.getMockImplementation()!;
    spy.mockImplementation(async (input, init = {}) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/pipeline/stages/order') {
        calls.push({ method: String(init.method), url: url.pathname, body: JSON.parse(String(init.body)) });
        return jsonResponse({ data: pipelineOverview.stages });
      }
      return base(input, init);
    });
    const user = userEvent.setup();
    renderApp('/settings');
    await screen.findByRole('list', { name: 'Etapas' });
    expect(screen.getByRole('button', { name: 'Subir Lead' })).toBeDisabled(); // la primera no puede subir
    await user.click(screen.getByRole('button', { name: 'Bajar Lead' }));
    await waitFor(() => expect(calls[0]?.body).toEqual({ ids: [2, 1, 3, 4, 5, 6] }));
    expect(calls[0]?.method).toBe('PUT');
  });

  it('deleting a stage that has deals asks where to move them, then deletes', async () => {
    const { calls, spy } = setup();
    const base = spy.getMockImplementation()!;
    spy.mockImplementation(async (input, init = {}) => {
      const url = new URL(String(input), 'http://localhost');
      if ((init.method ?? 'GET') === 'DELETE') {
        calls.push({ method: 'DELETE', url: url.pathname + url.search, body: null });
        if (!url.searchParams.get('moveTo')) {
          return jsonResponse({ error: { code: 'STAGE_IN_USE', message: 'Hay 3 deal(s)…', details: { deals: 3 } } }, 409);
        }
        return new Response(null, { status: 204 });
      }
      return base(input, init);
    });
    const user = userEvent.setup();
    renderApp('/settings');
    await screen.findByRole('list', { name: 'Etapas' });
    await user.click(within(row('qualified')).getByRole('button', { name: 'Eliminar' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/te preguntaré a qué etapa moverlos/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar etapa' }));

    expect(await within(dialog).findByText(/3/, { selector: 'strong' })).toBeInTheDocument();
    expect(within(dialog).getByText(/¿A qué etapa los movemos\?/)).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Mover a'), 'Propuesta');
    await user.click(within(dialog).getByRole('button', { name: 'Mover deals y eliminar' }));

    await waitFor(() => expect(calls.map((c) => c.url)).toEqual(['/api/pipeline/stages/2', '/api/pipeline/stages/2?moveTo=3']));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the server’s rule when a deletion is not allowed (e.g. the last won stage)', async () => {
    const { spy } = setup();
    const base = spy.getMockImplementation()!;
    spy.mockImplementation(async (input, init = {}) => {
      if ((init.method ?? 'GET') === 'DELETE') {
        return jsonResponse({ error: { code: 'LAST_OF_KIND', message: 'Debe quedar al menos una etapa ganada' } }, 409);
      }
      return base(input, init);
    });
    const user = userEvent.setup();
    renderApp('/settings');
    await screen.findByRole('list', { name: 'Etapas' });
    await user.click(within(row('won')).getByRole('button', { name: 'Eliminar' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Eliminar etapa' }));
    expect(await within(screen.getByRole('dialog')).findByText('Debe quedar al menos una etapa ganada')).toBeInTheDocument();
  });
});

describe('Lead sources and loss reasons (Ajustes)', () => {
  it('lists both lists, adds an entry and says when a used one is archived instead of deleted', async () => {
    const { calls, spy } = setup();
    const base = spy.getMockImplementation()!;
    spy.mockImplementation(async (input, init = {}) => {
      const url = new URL(String(input), 'http://localhost');
      const method = String(init.method ?? 'GET');
      if (method === 'POST' && url.pathname === '/api/pipeline/options/lead_source') {
        calls.push({ method, url: url.pathname, body: JSON.parse(String(init.body)) });
        return jsonResponse({ id: 99, kind: 'lead_source', name: 'Podcast', position: 3, archived: false }, 201);
      }
      if (method === 'DELETE' && url.pathname === '/api/pipeline/options/loss_reason/11') {
        calls.push({ method, url: url.pathname, body: null });
        return jsonResponse({ result: 'archived' });
      }
      return base(input, init);
    });
    const user = userEvent.setup();
    renderApp('/settings');

    const sources = await screen.findByRole('list', { name: 'Orígenes de lead' });
    expect(within(sources).getByLabelText('Nombre de Web')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Añadir', { selector: '#new-lead_source' }), 'Podcast');
    await user.click(within(screen.getByRole('form', { name: 'Añadir a Orígenes de lead' })).getByRole('button', { name: 'Añadir' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Podcast' }));

    const reasons = screen.getByRole('list', { name: 'Motivos de pérdida' });
    await user.click(within(within(reasons).getByLabelText('Nombre de Precio').closest('li')!).getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByText(/ya se usa en deals: se archivó/i)).toBeInTheDocument();
  });
});
