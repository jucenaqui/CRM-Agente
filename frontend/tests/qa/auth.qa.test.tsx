import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, adminUser, salesUser, emptyStats, currentPath, TOKEN_KEY } from './utils';

describe('QA · Auth flows', () => {
  it('[F-05] protected route without token redirects to /login', async () => {
    mockApi({});
    renderApp('/companies');
    expect(await screen.findByRole('heading', { name: /iniciar sesión/i })).toBeInTheDocument();
    expect(currentPath()).toBe('/login');
  });

  it('[F-01] login screen renders email, password and submit', async () => {
    mockApi({});
    renderApp('/login');
    expect(await screen.findByLabelText(/^Email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Contraseña/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
  });

  it('[F-01] client-side validation prevents empty submit', async () => {
    const { calls } = mockApi({});
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: /entrar/i }));
    expect(await screen.findByText(/email es obligatorio/i)).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/auth/login')).toHaveLength(0);
  });

  it('[F-02] successful login stores token and goes to dashboard', async () => {
    const { calls } = mockApi({
      'POST /api/auth/login': { token: 'tok-123', user: adminUser },
      'GET /api/auth/me': adminUser,
      'GET /api/dashboard/stats': emptyStats,
    });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText(/^Email/), 'ana@qa.test');
    await userEvent.type(screen.getByLabelText(/^Contraseña/), 'Password123!');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect(currentPath()).toBe('/');
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('tok-123');
    const login = calls.find((c) => c.path === '/api/auth/login')!;
    expect(login.method).toBe('POST');
    expect(login.body).toEqual({ email: 'ana@qa.test', password: 'Password123!' });
    const stats = calls.find((c) => c.path === '/api/dashboard/stats')!;
    expect(stats.headers.Authorization).toBe('Bearer tok-123');
  });

  it('[F-03] wrong credentials show backend error message', async () => {
    mockApi({
      'POST /api/auth/login': () => ({
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas' } },
      }),
    });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText(/^Email/), 'ana@qa.test');
    await userEvent.type(screen.getByLabelText(/^Contraseña/), 'bad');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument();
    expect(currentPath()).toBe('/login');
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('[F-04] register posts name/email/password and logs in', async () => {
    const { calls } = mockApi({
      'POST /api/auth/register': () => ({ status: 201, body: { token: 'tok-reg', user: salesUser } }),
      'GET /api/dashboard/stats': emptyStats,
    });
    renderApp('/register');
    await userEvent.type(await screen.findByLabelText(/^Nombre/), 'Sam Sales');
    await userEvent.type(screen.getByLabelText(/^Email/), 'sam@qa.test');
    await userEvent.type(screen.getByLabelText(/^Contraseña/), 'Password123!');
    await userEvent.type(screen.getByLabelText(/^Confirmar contraseña/), 'Password123!');
    await userEvent.click(screen.getByRole('button', { name: /crear cuenta|registr/i }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/auth/register')).toBe(true));
    const reg = calls.find((c) => c.path === '/api/auth/register')!;
    expect(reg.body).toMatchObject({ name: 'Sam Sales', email: 'sam@qa.test', password: 'Password123!' });
    expect(reg.body).not.toHaveProperty('role');
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('tok-reg');
  });

  it('[F-04] register with mismatched passwords does not call API', async () => {
    const { calls } = mockApi({});
    renderApp('/register');
    await userEvent.type(await screen.findByLabelText(/^Nombre/), 'X');
    await userEvent.type(screen.getByLabelText(/^Email/), 'x@qa.test');
    await userEvent.type(screen.getByLabelText(/^Contraseña/), 'Password123!');
    await userEvent.type(screen.getByLabelText(/^Confirmar contraseña/), 'Different123!');
    await userEvent.click(screen.getByRole('button', { name: /crear cuenta|registr/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.some((c) => c.path === '/api/auth/register')).toBe(false);
  });

  it('[F-04] register duplicate email shows 409 message', async () => {
    mockApi({
      'POST /api/auth/register': () => ({
        status: 409,
        body: { error: { code: 'EMAIL_TAKEN', message: 'El email ya está registrado' } },
      }),
    });
    renderApp('/register');
    await userEvent.type(await screen.findByLabelText(/^Nombre/), 'X');
    await userEvent.type(screen.getByLabelText(/^Email/), 'x@qa.test');
    await userEvent.type(screen.getByLabelText(/^Contraseña/), 'Password123!');
    await userEvent.type(screen.getByLabelText(/^Confirmar contraseña/), 'Password123!');
    await userEvent.click(screen.getByRole('button', { name: /crear cuenta|registr/i }));
    expect(await screen.findByText(/ya está registrado/i)).toBeInTheDocument();
  });

  it('[F-05] stored token restores session via /auth/me', async () => {
    const { calls } = mockApi({ 'GET /api/auth/me': adminUser, 'GET /api/dashboard/stats': emptyStats });
    renderApp('/', { token: 'stored' });
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect(calls[0].path).toBe('/api/auth/me');
    expect(calls[0].headers.Authorization).toBe('Bearer stored');
  });

  it('[F-05] invalid stored token (401 on /me) goes to login and clears token', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'x' } } }),
    });
    renderApp('/deals', { token: 'expired' });
    expect(await screen.findByRole('heading', { name: /iniciar sesión/i })).toBeInTheDocument();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('[F-05] 401 on any API call logs the user out', async () => {
    mockApi({
      'GET /api/auth/me': adminUser,
      'GET /api/companies': () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'expired' } } }),
    });
    renderApp('/companies', { token: 'tok' });
    expect(await screen.findByRole('heading', { name: /iniciar sesión/i })).toBeInTheDocument();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('[F-12] logout clears token and returns to login', async () => {
    mockApi({ 'GET /api/auth/me': adminUser, 'GET /api/dashboard/stats': emptyStats });
    renderApp('/', { token: 'tok' });
    const nav = await screen.findByRole('complementary', { name: /navegación/i });
    await userEvent.click(within(nav).getByRole('button', { name: /salir/i }));
    expect(await screen.findByRole('heading', { name: /iniciar sesión/i })).toBeInTheDocument();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('[F-02] authenticated user visiting /login is redirected to dashboard', async () => {
    mockApi({ 'GET /api/auth/me': salesUser, 'GET /api/dashboard/stats': emptyStats });
    renderApp('/login', { token: 'tok' });
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });
});
