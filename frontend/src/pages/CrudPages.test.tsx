import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetTokenCache } from '../api/client';
import { adminUser, jsonResponse, mockFetch, renderApp } from '../test/utils';

const company = {
  id: 10,
  name: 'ACME Corp',
  industry: 'Software',
  website: 'acme.com',
  phone: null,
  address: null,
  ownerId: 1,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
};

const deal = {
  id: 7,
  title: 'Licencias 2027',
  value: 1200,
  currency: 'USD',
  stage: 'lead',
  contactId: null,
  companyId: 10,
  ownerId: 1,
  expectedCloseDate: null,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
};

const page = <T,>(data: T[]) => ({ data, total: data.length, page: 1, pageSize: 10 });

describe('páginas CRUD', () => {
  beforeEach(() => {
    resetTokenCache();
    window.localStorage.setItem('newcrm.token', 'good');
  });

  it('Empresas: lista, muestra estado vacío de búsqueda y borra con modal de confirmación', async () => {
    let companies = [company];
    const spy = mockFetch({
      'GET /api/auth/me': () => jsonResponse(adminUser),
      'GET /api/companies': (url) =>
        jsonResponse(page(url.searchParams.get('search') ? [] : companies)),
      'DELETE /api/companies/10': () => {
        companies = [];
        return new Response(null, { status: 204 });
      },
    });
    renderApp('/companies');
    expect(await screen.findByRole('link', { name: 'ACME Corp' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/ACME Corp/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /eliminar/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(spy.mock.calls.some(([u, i]) => String(u) === '/api/companies/10' && i?.method === 'DELETE')).toBe(true);
    expect(await screen.findByText('Aún no hay empresas')).toBeInTheDocument();
  });

  it('Empresas: el formulario valida el nombre obligatorio', async () => {
    const spy = mockFetch({
      'GET /api/auth/me': () => jsonResponse(adminUser),
      'GET /api/companies': () => jsonResponse(page([])),
    });
    renderApp('/companies');
    await userEvent.click(await screen.findByRole('button', { name: /nueva empresa/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('El nombre es obligatorio')).toBeInTheDocument();
    expect(spy.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  });

  it('Deals kanban: mover a la siguiente etapa llama a PATCH /deals/:id/stage', async () => {
    const spy = mockFetch({
      'GET /api/auth/me': () => jsonResponse(adminUser),
      'GET /api/companies': () => jsonResponse(page([company])),
      'GET /api/contacts': () => jsonResponse(page([])),
      'GET /api/deals': () => jsonResponse(page([deal])),
      'PATCH /api/deals/7/stage': () => jsonResponse({ ...deal, stage: 'qualified' }),
    });
    renderApp('/deals?view=kanban');
    const leadCol = await screen.findByRole('listitem', { name: 'Etapa Lead' });
    expect(await within(leadCol).findByText('Licencias 2027')).toBeInTheDocument();

    await userEvent.click(within(leadCol).getByRole('button', { name: /etapa siguiente/i }));

    const qualifiedCol = screen.getByRole('listitem', { name: 'Etapa Calificado' });
    expect(await within(qualifiedCol).findByText('Licencias 2027')).toBeInTheDocument();
    const call = spy.mock.calls.find(([u]) => String(u) === '/api/deals/7/stage')!;
    expect(call[1]!.method).toBe('PATCH');
    expect(call[1]!.body).toBe(JSON.stringify({ stage: 'qualified' }));
  });

  it('Actividades: marcar como completada hace PATCH {completed:true}', async () => {
    const activity = {
      id: 3,
      type: 'call',
      subject: 'Llamar a ACME',
      description: null,
      dueDate: '2030-01-01T10:00:00.000Z',
      completed: false,
      contactId: null,
      dealId: null,
      ownerId: 1,
      createdAt: '2026-02-01T00:00:00.000Z',
    };
    const spy = mockFetch({
      'GET /api/auth/me': () => jsonResponse(adminUser),
      'GET /api/contacts': () => jsonResponse(page([])),
      'GET /api/deals': () => jsonResponse(page([])),
      'GET /api/activities': () => jsonResponse(page([activity])),
      'PATCH /api/activities/3': () => jsonResponse({ ...activity, completed: true }),
    });
    renderApp('/activities');
    const check = await screen.findByRole('checkbox', { name: /marcar "llamar a acme" como completada/i });
    await userEvent.click(check);
    await waitFor(() => {
      const call = spy.mock.calls.find(([u, i]) => String(u) === '/api/activities/3' && i?.method === 'PATCH');
      expect(call?.[1]?.body).toBe(JSON.stringify({ completed: true }));
    });
    // Por defecto se filtran pendientes
    const listCall = spy.mock.calls.find(([u]) => String(u).startsWith('/api/activities?'));
    expect(String(listCall![0])).toContain('completed=false');
  });

  it('Dashboard: muestra error y permite reintentar', async () => {
    let fail = true;
    mockFetch({
      'GET /api/auth/me': () => jsonResponse(adminUser),
      'GET /api/dashboard/stats': () =>
        fail
          ? jsonResponse({ error: { code: 'INTERNAL', message: 'Fallo del servidor' } }, 500)
          : jsonResponse({
              totals: { companies: 1, contacts: 0, deals: 0, openDealsValue: 0, wonDealsValue: 0 },
              dealsByStage: [],
              upcomingActivities: [],
            }),
    });
    renderApp('/');
    expect(await screen.findByText('Fallo del servidor')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Sin deals todavía')).toBeInTheDocument();
  });
});
