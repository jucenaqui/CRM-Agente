import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/Toast';
import { AppRoutes } from '../App';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** Mock de fetch enrutado por "MÉTODO /ruta" (sin query). Devuelve el spy. */
export function mockFetch(routes: Record<string, Handler>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${(init.method ?? 'GET').toUpperCase()} ${url.pathname}`;
    const h = routes[key];
    if (!h) return jsonResponse({ error: { code: 'NOT_FOUND', message: `Sin mock para ${key}` } }, 404);
    return h(url, init);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

export function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

export const adminUser = { id: 1, name: 'Ana Admin', email: 'ana@test.com', role: 'admin' as const, createdAt: '2026-01-01T00:00:00.000Z' };
export const salesUser = { id: 2, name: 'Sergio Sales', email: 'sergio@test.com', role: 'sales' as const, createdAt: '2026-01-01T00:00:00.000Z' };

export const emptyStats = {
  totals: { companies: 3, contacts: 5, deals: 2, openDealsValue: 1500, wonDealsValue: 900 },
  dealsByStage: [
    { stage: 'lead', count: 1, value: 500 },
    { stage: 'won', count: 1, value: 900 },
  ],
  upcomingActivities: [],
};
