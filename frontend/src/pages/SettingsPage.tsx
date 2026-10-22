import { useEffect, useState, type FormEvent } from 'react';
import { agentApi, type ApiToken, type KeyPolicy } from '../api/agent';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Badges';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../utils/format';
import { useAsync } from '../utils/hooks';

const POLICY_TEXT: Record<KeyPolicy, string> = {
  default: 'Si guardas tu clave de Anthropic, el asistente usa solo la tuya. Sin ella, usa la clave de tu proveedor del CRM.',
  provider_only: 'En este servicio el asistente usa siempre la clave de tu proveedor del CRM.',
  customer_only: 'En este servicio el asistente usa solo tu clave de Anthropic; debes guardarla aquí.',
  customer_then_provider:
    'El asistente usa tu clave de Anthropic. Si se queda sin saldo o deja de ser válida, pasa a la clave de tu proveedor dentro de un límite mensual.',
};

const KEY_STATUS: Record<string, { label: string; cls: string }> = {
  ok: { label: 'Funciona', cls: 'badge badge-ok' },
  unverified: { label: 'Sin verificar', cls: 'badge' },
  exhausted: { label: 'Sin saldo', cls: 'badge badge-bad' },
  invalid: { label: 'No válida', cls: 'badge badge-bad' },
};

/** Dinero con 3 decimales por debajo de 1 USD (los mensajes cuestan céntimos o menos). */
const usd = (n: number) => (n === 0 ? '$0.00' : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const num = (n: number) => n.toLocaleString('es');

type Settings = import('../api/agent').AgentSettings;

/** Quién paga de verdad ahora mismo, teniendo en cuenta el estado de la clave del cliente. */
function payerText(s: Settings): { text: string; problem: boolean } {
  const bad = s.customerKey.status === 'exhausted' || s.customerKey.status === 'invalid';
  if (s.effectiveSource === 'customer' && bad) {
    const why = s.customerKey.status === 'exhausted' ? 'no tiene saldo' : 'no es válida';
    return s.fallback.enabled && !s.fallback.capReached
      ? { text: `la clave de tu proveedor (respaldo: tu clave ${why})`, problem: false }
      : { text: `nadie: tu clave ${why} y el asistente no responderá hasta que la corrijas`, problem: true };
  }
  if (s.effectiveSource === 'customer') return { text: 'tu clave de Anthropic', problem: false };
  if (s.effectiveSource === 'provider') return { text: 'la clave de tu proveedor', problem: false };
  return { text: 'nadie: el asistente no está configurado', problem: true };
}

export function SettingsPage() {
  const { isAdmin } = useAuth();
  return (
    <>
      <PageHeader title="Ajustes" subtitle="Asistente IA y conexión con tus aplicaciones." />
      {isAdmin && <AssistantSection />}
      <McpSection />
    </>
  );
}

function AssistantSection() {
  const toast = useToast();
  const settings = useAsync(() => agentApi.settings(), []);
  const usage = useAsync(() => agentApi.usage(), []);

  // Los datos cambian mientras se usa el asistente: se recargan al volver a esta pestaña.
  useEffect(() => {
    const onFocus = () => {
      settings.reload();
      usage.reload();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const s = settings.data;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await agentApi.saveCustomerKey(apiKey.trim());
      setApiKey('');
      toast.success('Clave guardada');
      settings.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await agentApi.removeCustomerKey();
      toast.success('Clave eliminada');
      settings.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="card" aria-labelledby="assistant-title">
      <h2 className="card-title" id="assistant-title">
        Asistente IA
      </h2>
      {settings.error ? (
        <ErrorState message={settings.error} onRetry={settings.reload} />
      ) : !s ? (
        <Loading />
      ) : (
        <>
          <p className="muted">{POLICY_TEXT[s.policy]}</p>
          <p className={payerText(s).problem ? 'text-danger' : undefined}>
            <strong>Pagando ahora:</strong> {payerText(s).text}
          </p>

          {s.customerKey.status === 'exhausted' && (
            <div className="alert alert-error">
              Tu clave no tiene saldo. Recárgalo en console.anthropic.com.
              {s.fallback.enabled ? ' Mientras tanto se usa la clave de tu proveedor.' : ' Hasta entonces el asistente no responderá.'}
            </div>
          )}
          {s.customerKey.status === 'invalid' && (
            <div className="alert alert-error">
              Tu clave ya no es válida. Guarda una nueva.
              {s.fallback.enabled ? ' Mientras tanto se usa la clave de tu proveedor.' : ' Hasta entonces el asistente no responderá.'}
            </div>
          )}

          {s.policy !== 'provider_only' && (
            <form onSubmit={save} className="settings-key" aria-label="Clave de Anthropic">
              <div className="field">
                <label htmlFor="anthropic-key">Tu clave de Anthropic</label>
                <input
                  id="anthropic-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={s.customerKey.configured ? `Guardada (…${s.customerKey.last4}). Pega otra para reemplazarla` : 'sk-ant-…'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <small className="muted">
                  Créala en console.anthropic.com. Se comprueba con Anthropic antes de guardarla y se almacena cifrada; no se vuelve a mostrar.
                </small>
                {formError && <div className="alert alert-error">{formError}</div>}
              </div>
              <div className="settings-actions">
                <button type="submit" className="btn btn-primary" disabled={saving || !apiKey.trim()}>
                  {saving ? 'Comprobando…' : 'Guardar clave'}
                </button>
                {s.customerKey.configured && (
                  <>
                    <span className={KEY_STATUS[s.customerKey.status ?? 'unverified'].cls}>
                      {KEY_STATUS[s.customerKey.status ?? 'unverified'].label}
                    </span>
                    <button type="button" className="btn btn-ghost text-danger" onClick={() => setRemoving(true)}>
                      Quitar clave
                    </button>
                  </>
                )}
              </div>
            </form>
          )}

          {s.fallback.enabled && (
            <p className="muted">
              Respaldo con la clave del proveedor este mes: {usd(s.fallback.spentUsd)} de {usd(s.fallback.capUsd)}
              {s.fallback.capReached ? ' (límite alcanzado)' : ''}.
            </p>
          )}

          <UsageTable usage={usage} onRefresh={() => { settings.reload(); usage.reload(); }} />
        </>
      )}
      <ConfirmDialog
        open={removing}
        title="Quitar la clave de Anthropic"
        message="El asistente dejará de usar tu clave. ¿Continuar?"
        confirmLabel="Quitar"
        onConfirm={remove}
        onClose={() => setRemoving(false)}
      />
    </section>
  );
}

const PAYER_LABEL = (source: string, fallback: boolean) =>
  source === 'customer' ? 'Tu clave de Anthropic' : fallback ? 'Clave del proveedor (respaldo)' : 'Clave del proveedor';

function UsageTable({
  usage,
  onRefresh,
}: {
  usage: ReturnType<typeof useAsync<Awaited<ReturnType<typeof agentApi.usage>>>>;
  onRefresh: () => void;
}) {
  const u = usage.data;
  if (usage.error) return <ErrorState message={usage.error} onRetry={usage.reload} />;
  if (!u) return null;
  const total = u.totals.reduce(
    (a, t) => ({ requests: a.requests + t.messages, input: a.input + t.inputTokens, output: a.output + t.outputTokens, cost: a.cost + t.costUsd }),
    { requests: 0, input: 0, output: 0, cost: 0 },
  );
  return (
    <div className="settings-usage">
      <div className="card-title-row">
        <h3>Consumo de {u.month}</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
          Actualizar
        </button>
      </div>
      {u.totals.length === 0 ? (
        <p className="muted">Todavía no hay consumo este mes.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quién paga</th>
                  <th>Peticiones a la IA</th>
                  <th>Tokens de entrada</th>
                  <th>Tokens de salida</th>
                  <th>Coste estimado</th>
                </tr>
              </thead>
              <tbody>
                {u.totals.map((t) => (
                  <tr key={`${t.source}-${t.viaFallback}`}>
                    <td data-label="Quién paga">{PAYER_LABEL(t.source, t.viaFallback)}</td>
                    <td data-label="Peticiones">{num(t.messages)}</td>
                    <td data-label="Entrada">{num(t.inputTokens)}</td>
                    <td data-label="Salida">{num(t.outputTokens)}</td>
                    <td data-label="Coste">{usd(t.costUsd)}</td>
                  </tr>
                ))}
                {u.totals.length > 1 && (
                  <tr>
                    <td data-label="Quién paga">
                      <strong>Total</strong>
                    </td>
                    <td data-label="Peticiones">
                      <strong>{num(total.requests)}</strong>
                    </td>
                    <td data-label="Entrada">
                      <strong>{num(total.input)}</strong>
                    </td>
                    <td data-label="Salida">
                      <strong>{num(total.output)}</strong>
                    </td>
                    <td data-label="Coste">
                      <strong>{usd(total.cost)}</strong>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Cada petición es un paso del asistente: una pregunta que consulta datos cuenta 2 o más. Costes estimados a precio de lista; la factura
            real está en console.anthropic.com.
          </p>
          <details>
            <summary>Desglose por usuario</summary>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Quién paga</th>
                    <th>Peticiones</th>
                    <th>Coste estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {u.byUser.map((r) => (
                    <tr key={`${r.userId}-${r.source}-${r.viaFallback}`}>
                      <td data-label="Usuario">{r.name ?? 'Usuario eliminado'}</td>
                      <td data-label="Quién paga">{PAYER_LABEL(r.source, r.viaFallback)}</td>
                      <td data-label="Peticiones">{num(r.steps)}</td>
                      <td data-label="Coste">{usd(r.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function McpSection() {
  const toast = useToast();
  const tokens = useAsync(() => agentApi.tokens(), []);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);

  const url = `${window.location.origin}/api/mcp`;
  const shown = created?.token ?? 'TU_TOKEN';

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const t = await agentApi.createToken(name.trim());
      setCreated({ name: t.name, token: t.token });
      setName('');
      tokens.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    try {
      await agentApi.revokeToken(revoking.id);
      toast.success('Token revocado');
      tokens.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRevoking(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copiado');
    } catch {
      toast.error('No se pudo copiar; selecciona el texto y cópialo a mano');
    }
  };

  const claudeCode = `claude mcp add --transport http newcrm ${url} --header "Authorization: Bearer ${shown}"`;
  const desktop = JSON.stringify(
    {
      mcpServers: {
        newcrm: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${NEWCRM_AUTH}'],
          env: { NEWCRM_AUTH: `Bearer ${shown}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <section className="card" aria-labelledby="mcp-title">
      <h2 className="card-title" id="mcp-title">
        Conexión con Claude (MCP)
      </h2>
      <p className="muted">
        Usa tu CRM desde Claude Code o Claude Desktop con tu propia suscripción de Claude: genera un token personal y pégalo en la aplicación. El
        token actúa con tus permisos y solo sirve para esta conexión.
      </p>

      <form onSubmit={create} className="settings-actions" aria-label="Crear token">
        <div className="field">
          <label htmlFor="token-name">Nombre del token</label>
          <input id="token-name" value={name} maxLength={80} placeholder="Mi portátil" onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={creating || !name.trim()}>
          Crear token
        </button>
      </form>

      {created && (
        <div className="alert alert-success" role="status">
          <p>
            <strong>Token «{created.name}» creado.</strong> Cópialo ahora: no se volverá a mostrar.
          </p>
          <code className="code-block">{created.token}</code>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(created.token)}>
            Copiar token
          </button>
        </div>
      )}

      {tokens.error ? (
        <ErrorState message={tokens.error} onRetry={tokens.reload} />
      ) : !tokens.data ? (
        <Loading />
      ) : tokens.data.data.length === 0 ? (
        <p className="muted">No tienes tokens activos.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Token</th>
                <th>Creado</th>
                <th>Último uso</th>
                <th className="col-actions">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.data.data.map((t) => (
                <tr key={t.id}>
                  <td data-label="Nombre">{t.name}</td>
                  <td data-label="Token">{t.tokenPrefix}…</td>
                  <td data-label="Creado">{formatDateTime(t.createdAt)}</td>
                  <td data-label="Último uso">{t.lastUsedAt ? formatDateTime(t.lastUsedAt) : 'Nunca'}</td>
                  <td className="col-actions">
                    <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setRevoking(t)}>
                      Revocar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Claude Code</h3>
      <code className="code-block">{claudeCode}</code>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(claudeCode)}>
        Copiar comando
      </button>

      <h3>Claude Desktop</h3>
      <p className="muted">
        Añade esto a su archivo de configuración (Ajustes → Desarrollador → Editar configuración). Usa el puente <code>mcp-remote</code>, que
        requiere Node.js; los pasos exactos pueden variar según la versión de la aplicación.
      </p>
      <pre className="code-block">{desktop}</pre>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(desktop)}>
        Copiar configuración
      </button>

      <ConfirmDialog
        open={revoking !== null}
        title="Revocar token"
        message={`La aplicación que use «${revoking?.name ?? ''}» dejará de poder conectarse.`}
        confirmLabel="Revocar"
        onConfirm={revoke}
        onClose={() => setRevoking(null)}
      />
    </section>
  );
}
