import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, adminUser, salesUser, page, currentPath, emptyStats } from './utils';

const ts = '2026-01-01T00:00:00.000Z';
const company = (id: number, name: string) => ({
  id, name, industry: 'Software', website: null, phone: null, address: null, ownerId: 2, createdAt: ts, updatedAt: ts,
});
const contact = (id: number, firstName: string, lastName: string, companyId: number | null = null) => ({
  id, firstName, lastName, email: `${firstName.toLowerCase()}@qa.test`, phone: null, position: null, companyId, ownerId: 2, createdAt: ts, updatedAt: ts,
});
const deal = (id: number, title: string, stage: string, value = 1000) => ({
  id, title, value, currency: 'USD', stage, contactId: null, companyId: null, ownerId: 2, expectedCloseDate: null, createdAt: ts, updatedAt: ts,
});
const activity = (id: number, subject: string, completed = false) => ({
  id, type: 'call', subject, description: null, dueDate: '2030-01-01T10:00:00.000Z', completed, contactId: null, dealId: null, ownerId: 2, createdAt: ts,
});

describe('QA · Screens', () => {
  it('[F-06] dashboard shows KPIs, funnel and upcoming activities', async () => {
    mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/dashboard/stats': {
        totals: { companies: 7, contacts: 13, deals: 21, openDealsValue: 5000, wonDealsValue: 2500 },
        dealsByStage: [
          { stage: 'lead', count: 4, value: 4000 },
          { stage: 'won', count: 2, value: 2500 },
        ],
        upcomingActivities: [activity(1, 'Llamar a Acme')],
      },
    });
    renderApp('/', { token: 't' });
    const kpis = await screen.findByRole('region', { name: /indicadores/i });
    expect(within(kpis).getByText('7')).toBeInTheDocument();
    expect(within(kpis).getByText('13')).toBeInTheDocument();
    expect(within(kpis).getByText('21')).toBeInTheDocument();
    expect(screen.getByLabelText(/Lead: 4 deals/)).toBeInTheDocument();
    expect(screen.getByText('Llamar a Acme')).toBeInTheDocument();
  });

  it('[F-06] dashboard shows error state when stats fail', async () => {
    mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/dashboard/stats': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } } }),
    });
    renderApp('/', { token: 't' });
    expect(await screen.findByText(/Boom/)).toBeInTheDocument();
  });

  it('[F-07] companies list renders rows and sends pagination params', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/companies': page([company(1, 'Acme Corp'), company(2, 'Globex')], 2),
    });
    renderApp('/companies', { token: 't' });
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
    const c = calls.find((x) => x.path === '/api/companies')!;
    expect(c.query.get('page')).toBe('1');
    expect(c.query.get('pageSize')).toBeTruthy();
  });

  it('[F-07] companies search sends ?search= (debounced)', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/companies': page([company(1, 'Acme Corp')]),
    });
    renderApp('/companies', { token: 't' });
    await screen.findByText('Acme Corp');
    await userEvent.type(screen.getByPlaceholderText(/buscar empresas/i), 'acme');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/companies' && c.query.get('search') === 'acme')).toBe(true), {
      timeout: 2000,
    });
  });

  it('[F-07] create company posts form data', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/companies': page([]),
      'POST /api/companies': ({ body }) => ({ status: 201, body: { ...company(9, body.name), ...body } }),
    });
    renderApp('/companies', { token: 't' });
    await userEvent.click(await screen.findByRole('button', { name: /nueva empresa/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Nombre/), 'Initech');
    await userEvent.type(within(dialog).getByLabelText(/^Industria/), 'IT');
    await userEvent.click(within(dialog).getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/companies')).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/companies')!;
    expect(post.body).toMatchObject({ name: 'Initech', industry: 'IT' });
    expect(post.body).not.toHaveProperty('ownerId');
  });

  it('[F-07][BUG-001] website without scheme is normalized to a URL the backend accepts', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/companies': page([]),
      'POST /api/companies': ({ body }) => ({ status: 201, body: { ...company(9, body.name), ...body } }),
    });
    renderApp('/companies', { token: 't' });
    await userEvent.click(await screen.findByRole('button', { name: /nueva empresa/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Nombre/), 'Acme');
    await userEvent.type(within(dialog).getByLabelText(/^Sitio web/), 'acme.com');
    await userEvent.click(within(dialog).getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/companies')).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/companies')!;
    expect(post.body.website).toMatch(/^https?:\/\/acme\.com$/);
  });

  it('[F-07] create company with empty name shows validation and no POST', async () => {
    const { calls } = mockApi({ 'GET /api/auth/me': salesUser, 'GET /api/companies': page([]) });
    renderApp('/companies', { token: 't' });
    await userEvent.click(await screen.findByRole('button', { name: /nueva empresa/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /guardar/i }));
    expect(await within(dialog).findByText(/obligatorio/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('[F-07] backend validation error is shown in the form', async () => {
    mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/companies': page([]),
      'POST /api/companies': () => ({
        status: 400,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos', details: [{ path: 'name', message: 'Nombre repetido' }] } },
      }),
    });
    renderApp('/companies', { token: 't' });
    await userEvent.click(await screen.findByRole('button', { name: /nueva empresa/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Nombre/), 'Dup');
    await userEvent.click(within(dialog).getByRole('button', { name: /guardar/i }));
    // INT-2: the field error ("Nombre repetido") and the general message can both be rendered.
    expect((await within(dialog).findAllByText(/Nombre repetido|Datos inválidos/)).length).toBeGreaterThan(0);
    expect(await within(dialog).findByText('Nombre repetido')).toBeInTheDocument();
  });

  it('[F-07] delete company asks confirmation then sends DELETE', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/companies': page([company(5, 'Doomed Inc')]),
      'DELETE /api/companies/:id': () => ({ status: 204 }),
    });
    renderApp('/companies', { token: 't' });
    await screen.findByText('Doomed Inc');
    await userEvent.click(screen.getByRole('button', { name: /eliminar/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Doomed Inc/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /eliminar|confirmar|sí/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/companies/5')).toBe(true));
  });

  it('[F-08] contacts list renders names and company filter param', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/contacts': page([contact(1, 'Laura', 'Pérez', 1)]),
      'GET /api/companies': page([company(1, 'Acme Corp')]),
    });
    renderApp('/contacts', { token: 't' });
    expect(await screen.findByText(/Laura/)).toBeInTheDocument();
    const select = screen.getByLabelText(/filtrar por empresa/i) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Acme Corp' })).toBeInTheDocument());
    await userEvent.selectOptions(select, '1');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/contacts' && c.query.get('companyId') === '1')).toBe(true));
  });

  it('[F-09] deals kanban shows one column per stage and moves a deal to next stage', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/deals': page([deal(1, 'Big Deal', 'lead'), deal(2, 'Won Deal', 'won')]),
      'PATCH /api/deals/:id/stage': ({ body }) => ({ status: 200, body: { ...deal(1, 'Big Deal', body.stage) } }),
    });
    renderApp('/deals?view=kanban', { token: 't' });
    const board = await screen.findByRole('list', { name: /pipeline de deals/i });
    for (const s of ['Lead', 'Calificado', 'Propuesta', 'Negociación', 'Ganado', 'Perdido']) {
      expect(within(board).getByRole('listitem', { name: `Etapa ${s}` })).toBeInTheDocument();
    }
    const leadCol = within(board).getByRole('listitem', { name: 'Etapa Lead' });
    expect(within(leadCol).getByText('Big Deal')).toBeInTheDocument();
    await userEvent.click(within(leadCol).getByRole('button', { name: /Mover "Big Deal" a la etapa siguiente/ }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/api/deals/1/stage');
      expect(patch?.body).toEqual({ stage: 'qualified' });
    });
    const qualCol = within(board).getByRole('listitem', { name: 'Etapa Calificado' });
    await waitFor(() => expect(within(qualCol).getByText('Big Deal')).toBeInTheDocument());
  });

  it('[F-09] failed stage move rolls back the card', async () => {
    mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/deals': page([deal(1, 'Sticky Deal', 'lead')]),
      'PATCH /api/deals/:id/stage': () => ({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'Prohibido' } } }),
    });
    renderApp('/deals?view=kanban', { token: 't' });
    const board = await screen.findByRole('list', { name: /pipeline de deals/i });
    const leadCol = within(board).getByRole('listitem', { name: 'Etapa Lead' });
    await userEvent.click(within(leadCol).getByRole('button', { name: /Mover "Sticky Deal" a la etapa siguiente/ }));
    await waitFor(() => expect(within(within(board).getByRole('listitem', { name: 'Etapa Lead' })).getByText('Sticky Deal')).toBeInTheDocument());
    expect(await screen.findByText(/Prohibido/)).toBeInTheDocument();
  });

  it('[F-09] deals list view filters by stage', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/deals': page([deal(1, 'Big Deal', 'lead')]),
    });
    renderApp('/deals', { token: 't' });
    expect(await screen.findByText('Big Deal')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/filtrar por etapa/i), 'won');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/deals' && c.query.get('stage') === 'won')).toBe(true));
  });

  it('[F-10] activities list loads pending and marks one as completed (PATCH)', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': salesUser,
      'GET /api/activities': page([activity(3, 'Enviar propuesta')]),
      'PATCH /api/activities/:id': ({ body }) => ({ status: 200, body: { ...activity(3, 'Enviar propuesta'), ...body } }),
    });
    renderApp('/activities', { token: 't' });
    await screen.findByText('Enviar propuesta');
    const first = calls.find((c) => c.path === '/api/activities')!;
    expect(first.query.get('completed')).toBe('false');
    await userEvent.click(screen.getByRole('checkbox', { name: /Marcar "Enviar propuesta" como completada/ }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/api/activities/3');
      expect(patch?.body).toEqual({ completed: true });
    });
  });

  it('[F-11] sales user does not see Usuarios in sidebar and /users redirects', async () => {
    mockApi({ 'GET /api/auth/me': salesUser, 'GET /api/dashboard/stats': emptyStats });
    renderApp('/users', { token: 't' });
    const nav = await screen.findByRole('complementary', { name: /navegación/i });
    expect(within(nav).queryByRole('link', { name: /usuarios/i })).not.toBeInTheDocument();
    await waitFor(() => expect(currentPath()).toBe('/'));
  });

  it('[F-11] admin sees Usuarios and the users list', async () => {
    mockApi({
      'GET /api/auth/me': adminUser,
      'GET /api/users': page([adminUser, salesUser]),
    });
    renderApp('/users', { token: 't' });
    const nav = await screen.findByRole('complementary', { name: /navegación/i });
    expect(within(nav).getByRole('link', { name: /usuarios/i })).toBeInTheDocument();
    expect(await screen.findByText('Sam Sales')).toBeInTheDocument();
    expect(screen.getByText('sam@qa.test')).toBeInTheDocument();
  });

  it('[F-13] sidebar navigation reaches every section', async () => {
    mockApi({ 'GET /api/auth/me': adminUser, 'GET /api/dashboard/stats': emptyStats });
    renderApp('/', { token: 't' });
    const nav = await screen.findByRole('complementary', { name: /navegación/i });
    for (const [label, path] of [
      ['Empresas', '/companies'],
      ['Contactos', '/contacts'],
      ['Deals', '/deals'],
      ['Actividades', '/activities'],
      ['Usuarios', '/users'],
      ['Dashboard', '/'],
    ] as const) {
      await userEvent.click(within(nav).getByRole('link', { name: label }));
      await waitFor(() => expect(currentPath()).toBe(path));
    }
  });

  it('[F-14] unknown route inside app shows not-found page', async () => {
    mockApi({ 'GET /api/auth/me': salesUser });
    renderApp('/no-such-page', { token: 't' });
    expect(await screen.findByText(/no encontrad|404/i)).toBeInTheDocument();
  });
});
