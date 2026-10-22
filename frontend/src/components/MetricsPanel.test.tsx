import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { setToken } from '../api/client';
import { pipelineOverview, sampleMetrics } from '../test/fixtures';
import { adminUser, emptyStats, jsonResponse, mockFetch, renderApp, salesUser } from '../test/utils';

function routes(user: typeof adminUser | typeof salesUser, metrics: unknown = sampleMetrics) {
  setToken('tok');
  return mockFetch({
    'GET /api/auth/me': () => jsonResponse(user),
    'GET /api/dashboard/stats': () => jsonResponse(emptyStats),
    'GET /api/pipeline': () => jsonResponse(pipelineOverview),
    'GET /api/dashboard/metrics': () => jsonResponse(metrics),
  });
}

describe('MetricsPanel', () => {
  it('shows the headline numbers and every report block', async () => {
    routes(adminUser);
    renderApp('/');
    const kpis = await screen.findByRole('list', { name: 'Indicadores de ventas' });
    expect(within(kpis).getByText('Ventas ganadas')).toBeInTheDocument();
    expect(within(kpis).getByText('50 %')).toBeInTheDocument(); // tasa de conversión
    expect(within(kpis).getByText('20 días')).toBeInTheDocument(); // ciclo de venta
    expect(within(kpis).getByText(/2\.?000/)).toBeInTheDocument(); // ticket medio
    expect(within(kpis).getByText('2 ganados de 4 cerrados')).toBeInTheDocument();
    expect(within(kpis).getByText('30+ días sin cambiar de etapa')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Ventas ganadas por mes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Embudo y conversión' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pronóstico por etapa' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Por qué se pierden' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Qué origen trae mejores clientes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deals estancados' })).toBeInTheDocument();
    expect(screen.getByText('Trato olvidado')).toBeInTheDocument();
    expect(screen.getByText('Sin origen')).toBeInTheDocument();
    expect(screen.getByText('Sin motivo')).toBeInTheDocument();
  });

  it('shows how deals move through the funnel: reached, conversion and days per stage', async () => {
    routes(adminUser);
    renderApp('/');
    const table = (await screen.findByRole('heading', { name: 'Embudo y conversión' })).closest('section')!;
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(6); // cabecera + 5 etapas
    const calificado = rows.find((r) => within(r).queryByText(/Calificado/))!;
    expect(within(calificado).getByText('71,4 %')).toBeInTheDocument();
    expect(within(calificado).getByText('9,5 días')).toBeInTheDocument();
    expect(within(table).getByText(/Saltarse una etapa cuenta/i)).toBeInTheDocument();
  });

  it('draws one column per month, reveals details on hover and offers the same data as a table', async () => {
    routes(adminUser);
    const user = userEvent.setup();
    renderApp('/');
    const columns = await screen.findAllByRole('button', { name: /ventas ganadas, \d+ perdidas/i });
    expect(columns).toHaveLength(12);
    const last = columns[11]!;
    expect(last).toHaveAccessibleName(/octubre de 2026.*2 ventas ganadas, 2 perdidas/i);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.hover(last);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(/2 ganadas · 2 perdidas/);
    await user.unhover(last);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());

    // keyboard users get the same readout
    last.focus();
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();

    const details = screen.getByText('Ver como tabla').closest('details')!;
    expect(within(details).getAllByRole('row')).toHaveLength(13); // cabecera + 12 meses
  });

  it('says so when there are no won sales yet instead of drawing an empty chart', async () => {
    routes(adminUser, { ...sampleMetrics, salesByMonth: sampleMetrics.salesByMonth.map((r) => ({ ...r, wonValue: 0, wonCount: 0 })) });
    renderApp('/');
    expect(await screen.findByText('Aún no hay ventas ganadas')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /ventas ganadas por mes/i })).not.toBeInTheDocument();
  });

  it('asks the server for the chosen period and keeps showing data while it reloads', async () => {
    const spy = routes(adminUser);
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('list', { name: 'Indicadores de ventas' });
    const metricsUrls = () => spy.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/dashboard/metrics'));
    expect(metricsUrls()[0]).toContain('period=90d');

    await user.click(screen.getByRole('button', { name: '30 días' }));
    await waitFor(() => expect(metricsUrls().some((u) => u.includes('period=30d'))).toBe(true));
    expect(screen.getByRole('button', { name: '30 días' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('list', { name: 'Indicadores de ventas' })).toBeInTheDocument(); // sin parpadeo
  });

  it('lets an admin look at one salesperson, and shows the per-seller table', async () => {
    const spy = routes(adminUser);
    const user = userEvent.setup();
    renderApp('/');
    const team = (await screen.findByRole('heading', { name: 'Por vendedor' })).closest('section')!;
    expect(within(team).getByText('Lucía Ventas')).toBeInTheDocument();
    const select = await screen.findByRole('combobox', { name: 'Vendedor' });
    expect(within(select).getByRole('option', { name: 'Todo el equipo' })).toBeInTheDocument();

    await user.selectOptions(select, 'Lucía Ventas');
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes('ownerId=3'))).toBe(true));
  });

  it('salespeople only get their own numbers: no seller picker, no team table', async () => {
    routes(salesUser, { ...sampleMetrics, byOwner: undefined });
    renderApp('/');
    await screen.findByRole('list', { name: 'Indicadores de ventas' });
    expect(screen.queryByRole('combobox', { name: 'Vendedor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Por vendedor' })).not.toBeInTheDocument();
  });

  it('shows a readable error, not a blank page, if the metrics have the wrong shape', async () => {
    routes(adminUser, { hola: 'mundo' });
    renderApp('/');
    expect(await screen.findByText(/métricas en un formato inesperado/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Métricas de ventas' })).toBeInTheDocument();
  });
});
