import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../../src/auth/AuthContext';
import { ToastProvider } from '../../src/components/Toast';
import { AppRoutes } from '../../src/App';
import { resetTokenCache } from '../../src/api/client';

export const TOKEN_KEY = 'newcrm.token';

export const adminUser = { id: 1, name: 'Ana Admin', email: 'ana@qa.test', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z' };
export const salesUser = { id: 2, name: 'Sam Sales', email: 'sam@qa.test', role: 'sales', createdAt: '2026-01-01T00:00:00.000Z' };

export type Handler = (ctx: { url: URL; method: string; body: any }) => { status?: number; body?: unknown } | undefined;

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
  headers: Record<string, string>;
}

export function page<T>(data: T[], total = data.length, p = 1, pageSize = 20) {
  return { data, total, page: p, pageSize };
}

/**
 * Installs a fetch mock. `routes` maps "METHOD /api/path" (no query) to a handler or static body.
 * Unknown routes return an empty paginated list for GET and 404 otherwise.
 */
export function mockApi(routes: Record<string, Handler | object>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, path: url.pathname, query: url.searchParams, body, headers });
    const key = `${method} ${url.pathname}`;
    let route: any = routes[key];
    if (route === undefined) {
      // pattern match with :id
      for (const [k, v] of Object.entries(routes)) {
        const re = new RegExp('^' + k.replace(/:[a-z]+/gi, '[^/]+') + '$');
        if (re.test(key)) {
          route = v;
          break;
        }
      }
    }
    let res: { status?: number; body?: unknown } | undefined;
    if (typeof route === 'function') res = route({ url, method, body });
    else if (route !== undefined) res = { status: 200, body: route };
    else if (method === 'GET') res = { status: 200, body: page([]) };
    else res = { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    const status = res?.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(res?.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

let lastPath = '';
function LocationProbe() {
  const loc = useLocation();
  lastPath = loc.pathname + loc.search;
  return <div data-testid="location">{lastPath}</div>;
}
export const currentPath = () => lastPath;

export function renderApp(route = '/', opts: { token?: string | null } = {}) {
  window.localStorage.clear();
  if (opts.token) window.localStorage.setItem(TOKEN_KEY, opts.token);
  resetTokenCache();
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
          <LocationProbe />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

export const emptyStats = {
  totals: { companies: 0, contacts: 0, deals: 0, openDealsValue: 0, wonDealsValue: 0 },
  dealsByStage: [],
  upcomingActivities: [],
};
