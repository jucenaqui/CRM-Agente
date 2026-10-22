import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetTokenCache } from '../api/client';
import { adminUser, emptyStats, jsonResponse, mockFetch, renderApp, salesUser } from '../test/utils';

describe('rutas protegidas', () => {
  beforeEach(() => resetTokenCache());

  it('sin token redirige a /login', async () => {
    mockFetch({});
    renderApp('/companies');
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });

  it('con token válido restaura la sesión vía /auth/me', async () => {
    window.localStorage.setItem('newcrm.token', 'good');
    mockFetch({
      'GET /api/auth/me': () => jsonResponse(adminUser),
      'GET /api/dashboard/stats': () => jsonResponse(emptyStats),
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Ana Admin')).toBeInTheDocument();
    // El admin ve el enlace a Usuarios
    expect(screen.getByRole('link', { name: /usuarios/i })).toBeInTheDocument();
  });

  it('token inválido (401 en /auth/me) limpia la sesión y manda a login', async () => {
    window.localStorage.setItem('newcrm.token', 'bad');
    mockFetch({ 'GET /api/auth/me': () => jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Token inválido' } }, 401) });
    renderApp('/deals');
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(window.localStorage.getItem('newcrm.token')).toBeNull();
  });

  it('usuario sales no puede acceder a /users ni ve el enlace', async () => {
    window.localStorage.setItem('newcrm.token', 'good');
    mockFetch({
      'GET /api/auth/me': () => jsonResponse(salesUser),
      'GET /api/dashboard/stats': () => jsonResponse(emptyStats),
    });
    renderApp('/users');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /usuarios/i })).not.toBeInTheDocument();
  });

  it('un 401 durante el uso hace logout automático', async () => {
    window.localStorage.setItem('newcrm.token', 'good');
    mockFetch({
      'GET /api/auth/me': () => jsonResponse(adminUser),
      'GET /api/dashboard/stats': () => jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Sesión expirada' } }, 401),
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(window.localStorage.getItem('newcrm.token')).toBeNull();
  });

  it('el botón Salir cierra sesión', async () => {
    window.localStorage.setItem('newcrm.token', 'good');
    mockFetch({
      'GET /api/auth/me': () => jsonResponse(adminUser),
      'GET /api/dashboard/stats': () => jsonResponse(emptyStats),
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Salir' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument());
    expect(window.localStorage.getItem('newcrm.token')).toBeNull();
  });
});
