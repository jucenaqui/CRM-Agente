import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetTokenCache } from '../api/client';
import type { PipelineOverview } from '../api/types';
import { pipelineOverview } from '../test/fixtures';
import { adminUser, jsonResponse, mockFetch, renderApp } from '../test/utils';

const deal = {
  id: 7,
  title: 'Licencias 2027',
  value: 1200,
  currency: 'USD',
  stage: 'negotiation',
  contactId: null,
  companyId: null,
  ownerId: 1,
  expectedCloseDate: null,
  closedAt: null,
  sourceId: null,
  lostReasonId: null,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
};
const page = <T,>(data: T[]) => ({ data, total: data.length, page: 1, pageSize: 10 });

/** Un cliente que adaptó su embudo: renombró «Calificado» y añadió «Demo agendada». */
const custom: PipelineOverview = {
  ...pipelineOverview,
  stages: [
    { id: 1, key: 'lead', name: 'Contacto inicial', position: 1, probability: 10, kind: 'open', color: '#868e96' },
    { id: 7, key: 'demo-agendada', name: 'Demo agendada', position: 2, probability: 40, kind: 'open', color: '#1baf7a' },
    { id: 4, key: 'negotiation', name: 'Negociación', position: 3, probability: 75, kind: 'open', color: '#f08c00' },
    { id: 5, key: 'won', name: 'Cliente', position: 4, probability: 100, kind: 'won', color: '#2f9e44' },
    { id: 6, key: 'lost', name: 'Perdido', position: 5, probability: 0, kind: 'lost', color: '#e03131' },
  ],
};

function routes(extra: Parameters<typeof mockFetch>[0] = {}, overview: PipelineOverview = pipelineOverview, deals: unknown[] = [deal]) {
  return mockFetch({
    'GET /api/auth/me': () => jsonResponse(adminUser),
    'GET /api/pipeline': () => jsonResponse(overview),
    'GET /api/companies': () => jsonResponse(page([])),
    'GET /api/contacts': () => jsonResponse(page([])),
    'GET /api/deals': () => jsonResponse(page(deals)),
    ...extra,
  });
}

describe('Deals with a customised pipeline', () => {
  beforeEach(() => {
    resetTokenCache();
    window.localStorage.setItem('newcrm.token', 'good');
  });

  it('kanban shows the client’s own stages, names and order', async () => {
    routes({}, custom);
    renderApp('/deals?view=kanban');
    const board = await screen.findByRole('list', { name: 'Pipeline de deals' });
    await waitFor(() => expect(within(board).getAllByRole('listitem')).toHaveLength(5));
    const names = within(board).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['Contacto inicial', 'Demo agendada', 'Negociación', 'Cliente', 'Perdido']);
    expect(screen.queryByRole('listitem', { name: 'Etapa Calificado' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'Etapa Negociación' })).getByText('Licencias 2027')).toBeInTheDocument();
  });

  it('the stage filter and the badge use the client’s names', async () => {
    routes({}, custom, [{ ...deal, stage: 'demo-agendada' }]);
    renderApp('/deals');
    const filter = await screen.findByRole('combobox', { name: 'Filtrar por etapa' });
    await waitFor(() => expect(within(filter).getByRole('option', { name: 'Demo agendada' })).toBeInTheDocument());
    expect(within(filter).queryByRole('option', { name: 'Calificado' })).not.toBeInTheDocument();
    const rowEl = (await screen.findByText('Licencias 2027')).closest('tr')!;
    expect(within(rowEl).getByText('Demo agendada')).toBeInTheDocument();
  });

  it('moving a deal to a lost stage asks why it was lost and sends the reason', async () => {
    const spy = routes({ 'PATCH /api/deals/7/stage': () => jsonResponse({ ...deal, stage: 'lost', lostReasonId: 11 }) });
    const user = userEvent.setup();
    renderApp('/deals?view=kanban');
    const col = await screen.findByRole('listitem', { name: 'Etapa Negociación' });
    await within(col).findByText('Licencias 2027');

    await user.click(within(col).getByRole('button', { name: /etapa siguiente/i })); // → Ganado
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u) === '/api/deals/7/stage')).toBe(true));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // ganar no pregunta nada
    expect(JSON.parse(String(spy.mock.calls.find(([u]) => String(u) === '/api/deals/7/stage')![1]!.body))).toEqual({ stage: 'won' });
  });

  it('asks for the loss reason when the target stage is “lost”, and cancelling moves nothing', async () => {
    const spy = routes({ 'PATCH /api/deals/7/stage': () => jsonResponse({ ...deal, stage: 'lost', lostReasonId: 11 }) }, pipelineOverview, [{ ...deal, stage: 'won' }]);
    const user = userEvent.setup();
    renderApp('/deals?view=kanban');
    const won = await screen.findByRole('listitem', { name: 'Etapa Ganado' });
    await within(won).findByText('Licencias 2027');
    await user.click(within(won).getByRole('button', { name: /etapa siguiente/i })); // Ganado → Perdido

    const dialog = await screen.findByRole('dialog', { name: '¿Por qué se perdió?' });
    expect(within(dialog).getByText('Licencias 2027')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(spy.mock.calls.some(([u]) => String(u).includes('/stage'))).toBe(false);
    expect(within(screen.getByRole('listitem', { name: 'Etapa Ganado' })).getByText('Licencias 2027')).toBeInTheDocument();

    await user.click(within(screen.getByRole('listitem', { name: 'Etapa Ganado' })).getByRole('button', { name: /etapa siguiente/i }));
    const again = await screen.findByRole('dialog', { name: '¿Por qué se perdió?' });
    await user.selectOptions(within(again).getByLabelText('Motivo'), 'Precio');
    await user.click(within(again).getByRole('button', { name: 'Marcar como perdido' }));

    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u) === '/api/deals/7/stage')).toBe(true));
    const body = JSON.parse(String(spy.mock.calls.find(([u]) => String(u) === '/api/deals/7/stage')![1]!.body));
    expect(body).toEqual({ stage: 'lost', lostReasonId: 11 });
    expect(within(await screen.findByRole('listitem', { name: 'Etapa Perdido' })).getByText('Licencias 2027')).toBeInTheDocument();
  });

  it('losing a deal without choosing a reason is allowed (reason null)', async () => {
    const spy = routes({ 'PATCH /api/deals/7/stage': () => jsonResponse({ ...deal, stage: 'lost' }) }, pipelineOverview, [{ ...deal, stage: 'won' }]);
    const user = userEvent.setup();
    renderApp('/deals?view=kanban');
    const won = await screen.findByRole('listitem', { name: 'Etapa Ganado' });
    await within(won).findByText('Licencias 2027');
    await user.click(within(won).getByRole('button', { name: /etapa siguiente/i }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Marcar como perdido' }));
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u) === '/api/deals/7/stage')).toBe(true));
    expect(JSON.parse(String(spy.mock.calls.find(([u]) => String(u) === '/api/deals/7/stage')![1]!.body))).toEqual({ stage: 'lost', lostReasonId: null });
  });
});

describe('Deal form: origin and loss reason', () => {
  beforeEach(() => {
    resetTokenCache();
    window.localStorage.setItem('newcrm.token', 'good');
  });

  it('new deals start in the first open stage; picking the origin sends sourceId', async () => {
    const spy = routes({ 'POST /api/deals': () => jsonResponse({ ...deal, id: 8, stage: 'lead', sourceId: 2 }, 201) }, custom, []);
    const user = userEvent.setup();
    renderApp('/deals');
    await user.click(await screen.findByRole('button', { name: /nuevo deal/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Etapa')).toHaveValue('lead'); // «Contacto inicial»
    expect(within(dialog).queryByLabelText('Motivo de pérdida')).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/título/i), 'Trato nuevo');
    await user.type(within(dialog).getByLabelText(/valor/i), '500');
    await user.selectOptions(within(dialog).getByLabelText('Origen del lead'), 'Recomendación');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true));
    const body = JSON.parse(String(spy.mock.calls.find(([, i]) => i?.method === 'POST')![1]!.body));
    expect(body).toMatchObject({ title: 'Trato nuevo', value: 500, stage: 'lead', sourceId: 2, lostReasonId: null });
  });

  it('the loss-reason field only appears for a lost stage and is sent only then', async () => {
    const spy = routes({ 'PATCH /api/deals/7': () => jsonResponse({ ...deal, stage: 'lost' }) });
    const user = userEvent.setup();
    renderApp('/deals');
    await user.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Motivo de pérdida')).not.toBeInTheDocument();

    await user.selectOptions(within(dialog).getByLabelText('Etapa'), 'Perdido');
    const reason = await within(dialog).findByLabelText('Motivo de pérdida');
    await user.selectOptions(reason, 'Sin presupuesto');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy.mock.calls.some(([u, i]) => String(u) === '/api/deals/7' && i?.method === 'PATCH')).toBe(true));
    const body = JSON.parse(String(spy.mock.calls.find(([u, i]) => String(u) === '/api/deals/7' && i?.method === 'PATCH')![1]!.body));
    expect(body).toMatchObject({ stage: 'lost', lostReasonId: 12 });
  });

  it('shows the real close date of a closed deal', async () => {
    routes({}, pipelineOverview, [{ ...deal, stage: 'won', closedAt: '2026-09-15T10:00:00.000Z' }]);
    const user = userEvent.setup();
    renderApp('/deals');
    await user.click(await screen.findByRole('button', { name: 'Editar' }));
    expect(await within(await screen.findByRole('dialog')).findByText(/Cerrado el/)).toBeInTheDocument();
  });
});
