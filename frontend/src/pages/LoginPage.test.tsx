import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetTokenCache } from '../api/client';
import { adminUser, emptyStats, jsonResponse, mockFetch, renderApp } from '../test/utils';

describe('LoginPage', () => {
  beforeEach(() => resetTokenCache());

  it('valida campos obligatorios sin llamar a la API', async () => {
    const spy = mockFetch({});
    renderApp('/login');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    expect(await screen.findByText('El email es obligatorio')).toBeInTheDocument();
    expect(screen.getByText('La contraseña es obligatoria')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('valida formato de email', async () => {
    mockFetch({});
    renderApp('/login');
    await userEvent.type(screen.getByLabelText(/email/i), 'no-es-email');
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    expect(await screen.findByText('Email inválido')).toBeInTheDocument();
  });

  it('muestra el mensaje de error del backend', async () => {
    mockFetch({
      'POST /api/auth/login': () => jsonResponse({ error: { code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas' } }, 401),
    });
    renderApp('/login');
    await userEvent.type(screen.getByLabelText(/email/i), 'ana@test.com');
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'mala-clave');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas');
    expect(window.localStorage.getItem('newcrm.token')).toBeNull();
  });

  it('inicia sesión, guarda el token y navega al dashboard', async () => {
    const spy = mockFetch({
      'POST /api/auth/login': () => jsonResponse({ token: 'jwt-token', user: adminUser }),
      'GET /api/dashboard/stats': () => jsonResponse(emptyStats),
    });
    renderApp('/login');
    await userEvent.type(screen.getByLabelText(/email/i), 'ana@test.com');
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(window.localStorage.getItem('newcrm.token')).toBe('jwt-token');
    const loginCall = spy.mock.calls.find(([u]) => String(u) === '/api/auth/login')!;
    expect(loginCall[1]!.body).toBe(JSON.stringify({ email: 'ana@test.com', password: 'secret123' }));
    // El dashboard pide stats con el token recién obtenido
    await waitFor(() => {
      const statsCall = spy.mock.calls.find(([u]) => String(u) === '/api/dashboard/stats');
      expect((statsCall![1]!.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');
    });
    expect(await screen.findByText('Pipeline abierto')).toBeInTheDocument();
  });
});
