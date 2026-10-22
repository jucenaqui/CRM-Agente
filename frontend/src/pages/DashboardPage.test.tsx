import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseStats } from '../api/endpoints';
import { setToken } from '../api/client';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { adminUser, emptyStats, jsonResponse, mockFetch, renderApp } from '../test/utils';

function routes(stats: unknown) {
  setToken('tok');
  return mockFetch({
    'GET /api/auth/me': () => jsonResponse(adminUser),
    'GET /api/dashboard/stats': () => jsonResponse(stats),
  });
}

describe('Dashboard with unexpected data (BUG-003)', () => {
  it('shows a readable error instead of a blank page when stats has the wrong shape', async () => {
    routes({ data: [], total: 0, page: 1, pageSize: 20 }); // p. ej. un proxy que devuelve otra cosa
    renderApp('/');
    expect(await screen.findByText(/formato inesperado/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument(); // la página sigue ahí
  });

  it.each([
    ['sin totals', { dealsByStage: [], upcomingActivities: [] }],
    ['totals con texto', { ...emptyStats, totals: { ...emptyStats.totals, deals: 'mucho' } }],
    ['dealsByStage no es lista', { ...emptyStats, dealsByStage: {} }],
    ['etapa sin cuenta', { ...emptyStats, dealsByStage: [{ stage: 'lead' }] }],
    ['sin upcomingActivities', { totals: emptyStats.totals, dealsByStage: [] }],
    ['null', null],
  ])('rejects %s', (_name, bad) => {
    expect(() => parseStats(bad)).toThrow(/formato inesperado/);
  });

  it('still shows the dashboard when the response is right', async () => {
    routes(emptyStats);
    renderApp('/');
    expect(await screen.findByText('Pipeline abierto')).toBeInTheDocument();
    expect(screen.queryByText(/formato inesperado/i)).not.toBeInTheDocument();
  });
});

describe('ErrorBoundary', () => {
  // React reenvía el error simulado a `window`; jsdom lo imprimiría como «uncaught» aunque el boundary lo capture.
  const swallow = (e: ErrorEvent) => e.preventDefault();
  beforeEach(() => window.addEventListener('error', swallow));
  afterEach(() => window.removeEventListener('error', swallow));

  function Bomb({ explode }: { explode: boolean }) {
    if (explode) throw new Error('boom');
    return <p>contenido sano</p>;
  }

  it('catches a render crash and shows options instead of a blank page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined); // React y el boundary registran el error
    render(
      <ErrorBoundary>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/algo salió mal/i);
    expect(screen.getByRole('button', { name: 'Recargar la página' })).toBeInTheDocument();
  });

  it('recovers when the route changes (resetKey) or when retrying after the cause is gone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Harness() {
      const [page, setPage] = useState('a');
      return (
        <>
          <button onClick={() => setPage('b')}>ir a b</button>
          <ErrorBoundary resetKey={page}>
            <Bomb explode={page === 'a'} />
          </ErrorBoundary>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ir a b' }));
    expect(screen.getByText('contenido sano')).toBeInTheDocument();
  });
});
