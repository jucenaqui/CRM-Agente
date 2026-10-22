import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { setToken } from '../api/client';
import { adminUser, emptyStats, jsonResponse, mockFetch, renderApp, salesUser } from '../test/utils';

const baseSettings = {
  policy: 'default',
  providerKeyConfigured: true,
  customerKey: { configured: false, last4: null, status: null, statusAt: null },
  effectiveSource: 'provider',
  fallback: { enabled: false, capUsd: 10, spentUsd: 0, capReached: false },
};
const emptyUsage = { month: '2026-10', totals: [], byUser: [] };

function routes(user: typeof adminUser | typeof salesUser, extra: Parameters<typeof mockFetch>[0] = {}) {
  setToken('tok');
  return mockFetch({
    'GET /api/auth/me': () => jsonResponse(user),
    'GET /api/dashboard/stats': () => jsonResponse(emptyStats),
    'GET /api/tokens': () => jsonResponse({ data: [] }),
    'GET /api/agent/settings': () => jsonResponse(baseSettings),
    'GET /api/agent/usage': () => jsonResponse(emptyUsage),
    ...extra,
  });
}

describe('SettingsPage', () => {
  it('shows only the MCP section to non-admins and never asks for the assistant settings', async () => {
    const spy = routes(salesUser);
    renderApp('/settings');
    expect(await screen.findByRole('heading', { name: /conexión con claude/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^asistente ia$/i })).not.toBeInTheDocument();
    expect(spy.mock.calls.some(([u]) => String(u).includes('/agent/settings'))).toBe(false);
  });

  it('lets an admin save their Anthropic key and shows who pays', async () => {
    let sent: unknown;
    let configured = false;
    routes(adminUser, {
      'GET /api/agent/settings': () =>
        jsonResponse(
          configured
            ? { ...baseSettings, effectiveSource: 'customer', customerKey: { configured: true, last4: 'WXYZ', status: 'ok', statusAt: null } }
            : baseSettings,
        ),
      'PUT /api/agent/settings/customer-key': (_u, init) => {
        sent = JSON.parse(String(init.body));
        configured = true;
        return jsonResponse({ configured: true, last4: 'WXYZ', status: 'ok', statusAt: null });
      },
    });
    const user = userEvent.setup();
    renderApp('/settings');
    expect(await screen.findByText('la clave de tu proveedor')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Tu clave de Anthropic'), 'sk-ant-customer-key-0123456789abcdWXYZ');
    await user.click(screen.getByRole('button', { name: 'Guardar clave' }));
    expect(await screen.findByText('tu clave de Anthropic')).toBeInTheDocument();
    expect(sent).toEqual({ apiKey: 'sk-ant-customer-key-0123456789abcdWXYZ' });
    expect(screen.getByLabelText('Tu clave de Anthropic')).toHaveValue('');
    expect(screen.getByText('Funciona')).toBeInTheDocument();
  });

  it('shows the error when Anthropic rejects the key', async () => {
    routes(adminUser, {
      'PUT /api/agent/settings/customer-key': () =>
        jsonResponse({ error: { code: 'VALIDATION_ERROR', message: 'Anthropic rechazó la clave: no es válida o no tiene permisos.' } }, 400),
    });
    const user = userEvent.setup();
    renderApp('/settings');
    await user.type(await screen.findByLabelText('Tu clave de Anthropic'), 'sk-ant-bad-bad-bad-bad-bad-bad');
    await user.click(screen.getByRole('button', { name: 'Guardar clave' }));
    expect(await screen.findByText(/anthropic rechazó la clave/i)).toBeInTheDocument();
  });

  it('warns when the customer key has no credit and says whether the provider key takes over', async () => {
    routes(adminUser, {
      'GET /api/agent/settings': () =>
        jsonResponse({
          ...baseSettings,
          policy: 'customer_then_provider',
          effectiveSource: 'customer',
          customerKey: { configured: true, last4: 'WXYZ', status: 'exhausted', statusAt: null },
          fallback: { enabled: true, capUsd: 10, spentUsd: 2.5, capReached: false },
        }),
    });
    renderApp('/settings');
    expect(await screen.findByText(/no tiene saldo/i)).toBeInTheDocument();
    expect(screen.getByText(/se usa la clave de tu proveedor/i)).toBeInTheDocument();
    expect(screen.getByText(/\$2\.50 de \$10\.00/)).toBeInTheDocument();
  });

  it('hides the key form when the service always uses the provider key', async () => {
    routes(adminUser, { 'GET /api/agent/settings': () => jsonResponse({ ...baseSettings, policy: 'provider_only' }) });
    renderApp('/settings');
    await screen.findByText(/usa siempre la clave de tu proveedor/i);
    expect(screen.queryByLabelText('Tu clave de Anthropic')).not.toBeInTheDocument();
  });

  it('creates a token, shows it once with ready-to-paste commands, and revokes it', async () => {
    let active = [{ id: 1, name: 'Viejo', tokenPrefix: 'ncrm_abcd', createdAt: '2026-10-01T10:00:00.000Z', lastUsedAt: null }];
    routes(salesUser, {
      'GET /api/tokens': () => jsonResponse({ data: active }),
      'POST /api/tokens': () => {
        active = [{ id: 2, name: 'Portátil', tokenPrefix: 'ncrm_wxyz', createdAt: '2026-10-22T10:00:00.000Z', lastUsedAt: null }, ...active];
        return jsonResponse({ ...active[0], token: 'ncrm_SECRETSECRETSECRET' }, 201);
      },
      'DELETE /api/tokens/1': () => {
        active = active.filter((t) => t.id !== 1);
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    renderApp('/settings');
    expect(await screen.findByText('Viejo')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nombre del token'), 'Portátil');
    await user.click(screen.getByRole('button', { name: 'Crear token' }));
    const banner = await screen.findByRole('status');
    expect(within(banner).getByText('ncrm_SECRETSECRETSECRET')).toBeInTheDocument();
    expect(screen.getByText(/claude mcp add --transport http newcrm .*\/api\/mcp --header "Authorization: Bearer ncrm_SECRETSECRETSECRET"/)).toBeInTheDocument();

    const row = screen.getByText('Viejo').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Revocar' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revocar' }));
    await waitFor(() => expect(screen.queryByText('Viejo')).not.toBeInTheDocument());
  });
});
