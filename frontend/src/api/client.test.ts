import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, buildQuery, getToken, request, resetTokenCache, setToken, setUnauthorizedHandler } from './client';
import { dealsApi } from './endpoints';
import { jsonResponse, mockFetch } from '../test/utils';

describe('api client', () => {
  beforeEach(() => {
    resetTokenCache();
  });
  afterEach(() => {
    setUnauthorizedHandler(null);
    setToken(null);
  });

  it('buildQuery omite valores vacíos', () => {
    expect(buildQuery({ page: 1, search: '', stage: undefined, completed: false })).toBe('?page=1&completed=false');
    expect(buildQuery({})).toBe('');
  });

  it('envía el token en Authorization y serializa el body', async () => {
    setToken('abc123');
    const spy = mockFetch({ 'POST /api/companies': () => jsonResponse({ id: 1, name: 'ACME' }, 201) });
    const res = await request<{ id: number }>('/companies', { method: 'POST', body: { name: 'ACME' } });
    expect(res.id).toBe(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('/api/companies');
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer abc123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init!.body).toBe(JSON.stringify({ name: 'ACME' }));
  });

  it('persiste el token en localStorage', () => {
    setToken('tok');
    expect(window.localStorage.getItem('newcrm.token')).toBe('tok');
    resetTokenCache();
    expect(getToken()).toBe('tok');
    setToken(null);
    expect(window.localStorage.getItem('newcrm.token')).toBeNull();
  });

  it('normaliza el formato de error del contrato', async () => {
    mockFetch({
      'POST /api/contacts': () =>
        jsonResponse(
          { error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos', details: [{ path: ['email'], message: 'Email inválido' }] } },
          422,
        ),
    });
    const err = await request('/contacts', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(422);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.message).toBe('Datos inválidos');
    expect(e.fieldErrors()).toEqual({ email: 'Email inválido' });
  });

  it('fieldErrors acepta path como string (formato real del backend)', () => {
    const e = new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data', [
      { path: 'name', message: 'Too small', code: 'too_small' },
    ]);
    expect(e.fieldErrors()).toEqual({ name: 'Too small' });
  });

  it('usa un mensaje por defecto si el body no tiene formato de error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })));
    await expect(request('/x')).rejects.toMatchObject({ status: 500, code: 'HTTP_500', message: 'Error interno del servidor' });
  });

  it('error de red -> NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(request('/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('en 401 borra el token y llama al handler de logout', async () => {
    setToken('expired');
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch({ 'GET /api/deals': () => jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Token inválido' } }, 401) });
    await expect(dealsApi.list()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(getToken()).toBeNull();
  });

  it('no dispara logout en 401 cuando handleUnauthorized=false (login)', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch({ 'POST /api/auth/login': () => jsonResponse({ error: { code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas' } }, 401) });
    await expect(request('/auth/login', { method: 'POST', body: {}, handleUnauthorized: false })).rejects.toMatchObject({
      message: 'Credenciales inválidas',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('204 devuelve undefined', async () => {
    mockFetch({ 'DELETE /api/deals/5': () => new Response(null, { status: 204 }) });
    await expect(dealsApi.remove(5)).resolves.toBeUndefined();
  });

  it('moveStage hace PATCH /deals/:id/stage con {stage}', async () => {
    const spy = mockFetch({ 'PATCH /api/deals/7/stage': () => jsonResponse({ id: 7, stage: 'won' }) });
    await dealsApi.moveStage(7, 'won');
    expect(spy.mock.calls[0]![1]!.body).toBe(JSON.stringify({ stage: 'won' }));
  });

  it('list pasa paginación y filtros como query', async () => {
    const spy = mockFetch({ 'GET /api/deals': () => jsonResponse({ data: [], total: 0, page: 2, pageSize: 10 }) });
    await dealsApi.list({ page: 2, pageSize: 10, stage: 'lead', search: 'abc' });
    expect(String(spy.mock.calls[0]![0])).toBe('/api/deals?page=2&pageSize=10&stage=lead&search=abc');
  });
});
