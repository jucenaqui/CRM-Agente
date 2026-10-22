import { useEffect, useState } from 'react';
import { metricsApi } from '../api/endpoints';
import type { Metrics, MetricsPeriod } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ACTIVITY_LABELS, formatMoney } from '../utils/format';
import { useAsync } from '../utils/hooks';
import { usePipeline } from '../utils/pipeline';
import { StageBadge } from './Badges';
import { EmptyState, ErrorState, Loading } from './States';

const PERIODS: { value: MetricsPeriod; label: string }[] = [
  { value: '30d', label: '30 días' },
  { value: '90d', label: '90 días' },
  { value: '12m', label: '12 meses' },
  { value: 'all', label: 'Todo' },
];

const num = (n: number) => n.toLocaleString('es');
const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es', { maximumFractionDigits: 1 })} %`);
const days = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es', { maximumFractionDigits: 1 })} días`);
const compact = (n: number) => new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** «oct» / «octubre de 2026» a partir de 'YYYY-MM'. */
const monthShort = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('es', { month: 'short', timeZone: 'UTC' }).replace('.', '');
const monthLong = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('es', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h3 className="card-title">{title}</h3>
      {hint && <p className="muted small metrics-hint">{hint}</p>}
      {children}
    </section>
  );
}

/** Barra horizontal fina: una sola serie, un solo color; el valor va en el texto, no en el color. */
function HBar({ ratio }: { ratio: number }) {
  return (
    <div className="hbar" aria-hidden="true">
      <div className="hbar-fill" style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} />
    </div>
  );
}

function SalesChart({ rows }: { rows: Metrics['salesByMonth'] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...rows.map((r) => r.wonValue));
  const top = max === 0 ? 1 : max;
  const maxIndex = rows.findIndex((r) => r.wonValue === max);
  if (max === 0) {
    return <EmptyState title="Aún no hay ventas ganadas" description="Cuando cierres deals como ganados, verás aquí cuánto vendes cada mes." />;
  }
  return (
    <>
      <div className="chart" role="group" aria-label="Ventas ganadas por mes, últimos 12 meses">
        <div className="chart-grid" aria-hidden="true">
          {[1, 0.5, 0].map((f) => (
            <div key={f} className="chart-gridline" style={{ bottom: `${f * 100}%` }}>
              <span>{compact(top * f)}</span>
            </div>
          ))}
        </div>
        <div className="chart-cols">
          {rows.map((r, i) => (
            <button
              key={r.month}
              type="button"
              className={`chart-col${active === i ? ' is-active' : ''}`}
              aria-label={`${monthLong(r.month)}: ${formatMoney(r.wonValue)} en ${r.wonCount} ventas ganadas, ${r.lostCount} perdidas`}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive((a) => (a === i ? null : a))}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((a) => (a === i ? null : a))}
            >
              {i === maxIndex && <span className="chart-value">{compact(r.wonValue)}</span>}
              <span className="chart-bar" style={{ height: `${(r.wonValue / top) * 100}%` }} />
              <span className="chart-xlabel">{monthShort(r.month)}</span>
              {active === i && (
                <span className="chart-tip" role="tooltip">
                  <strong>{formatMoney(r.wonValue)}</strong>
                  <span>{monthLong(r.month)}</span>
                  <span>
                    {r.wonCount} ganadas · {r.lostCount} perdidas
                  </span>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <details className="chart-table">
        <summary>Ver como tabla</summary>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Ventas ganadas</th>
                <th>Deals ganados</th>
                <th>Deals perdidos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td data-label="Mes">{monthLong(r.month)}</td>
                  <td data-label="Ventas ganadas" className="num">
                    {formatMoney(r.wonValue)}
                  </td>
                  <td data-label="Deals ganados">{r.wonCount}</td>
                  <td data-label="Deals perdidos">{r.lostCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function Funnel({ rows }: { rows: Metrics['funnel'] }) {
  const p = usePipeline();
  const first = rows[0]?.reached ?? 0;
  if (first === 0) return <EmptyState title="Sin deals en este periodo" description="Crea deals para ver cómo avanzan por el embudo." />;
  return (
    <div className="table-wrap">
      <table className="table funnel-table">
        <thead>
          <tr>
            <th>Etapa</th>
            <th>Llegaron</th>
            <th>
              <span className="sr-only">Proporción</span>
            </th>
            <th>Avanzan a la siguiente</th>
            <th>Días en la etapa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.stage}>
              <td data-label="Etapa">
                <span className="stage-dot" style={{ background: p.stageColor(r.stage) }} aria-hidden="true" /> {r.name}
              </td>
              <td data-label="Llegaron" className="num">
                {num(r.reached)}
              </td>
              <td className="funnel-bar-cell" aria-hidden="true">
                <HBar ratio={r.reached / first} />
              </td>
              <td data-label="Avanzan">{r.conversionFromPrev === null ? '—' : pct(r.conversionFromPrev)}</td>
              <td data-label="Días">{days(r.avgDaysInStage)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MetricsPanel() {
  const { isAdmin } = useAuth();
  const [period, setPeriod] = useState<MetricsPeriod>('90d');
  const [ownerId, setOwnerId] = useState<number | undefined>();
  const [team, setTeam] = useState<{ id: number; name: string }[]>([]);
  const { data, loading, error, reload } = useAsync(() => metricsApi.get(period, ownerId), [period, ownerId]);

  // La lista de vendedores sólo llega cuando se mira a todo el equipo: se recuerda para el selector.
  useEffect(() => {
    if (data?.byOwner) setTeam(data.byOwner.map((o) => ({ id: o.ownerId, name: o.name })));
  }, [data]);

  return (
    <section className="metrics" aria-labelledby="metrics-title">
      <div className="metrics-head">
        <div>
          <h2 id="metrics-title">Métricas de ventas</h2>
          <p className="muted small">Lo que se vendió, lo que se pierde y lo que se espera vender.</p>
        </div>
        <div className="metrics-filters">
          <div className="segmented" role="group" aria-label="Periodo">
            {PERIODS.map((p) => (
              <button key={p.value} type="button" aria-pressed={period === p.value} className={period === p.value ? 'active' : ''} onClick={() => setPeriod(p.value)}>
                {p.label}
              </button>
            ))}
          </div>
          {isAdmin && team.length > 0 && (
            <select aria-label="Vendedor" value={ownerId ?? ''} onChange={(e) => setOwnerId(e.target.value === '' ? undefined : Number(e.target.value))}>
              <option value="">Todo el equipo</option>
              {team.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <div className={loading ? 'is-loading' : ''}>
          <MetricsBody m={data} />
        </div>
      )}
    </section>
  );
}

function MetricsBody({ m }: { m: Metrics }) {
  const s = m.summary;
  const closed = s.wonCount + s.lostCount;
  const maxReason = Math.max(1, ...m.lostReasons.map((r) => r.count));
  return (
    <>
      <div className="kpi-grid" role="list" aria-label="Indicadores de ventas">
        <Tile label="Ventas ganadas" value={formatMoney(s.wonValue)} sub={`${s.wonCount} deals`} />
        <Tile label="Tasa de conversión" value={pct(s.winRate)} sub={closed ? `${s.wonCount} ganados de ${closed} cerrados` : 'Sin deals cerrados'} />
        <Tile label="Ticket medio" value={s.avgDealSize === null ? '—' : formatMoney(s.avgDealSize)} sub="Valor medio de un deal ganado" />
        <Tile label="Ciclo de venta" value={days(s.avgCycleDays)} sub="Desde crear hasta ganar" />
        <Tile label="Pronóstico" value={formatMoney(s.weightedForecast)} sub={`Pipeline ${formatMoney(s.openValue)} · ${s.openCount} abiertos`} />
        <Tile label="Deals estancados" value={String(s.stalledCount)} sub="30+ días sin cambiar de etapa" />
        <Tile label="Actividades vencidas" value={String(s.overdueActivities)} sub="Pendientes con fecha pasada" />
      </div>

      <Block title="Ventas ganadas por mes" hint="Valor de los deals cerrados como ganados en cada mes, últimos 12 meses.">
        <SalesChart rows={m.salesByMonth} />
      </Block>

      <Block title="Embudo y conversión" hint="Deals creados en el periodo: hasta qué etapa llegaron y cuánto tardan en cada una. Saltarse una etapa cuenta como haberla pasado.">
        <Funnel rows={m.funnel} />
      </Block>

      <div className="grid-2">
        <Block title="Pronóstico por etapa" hint="Valor de cada etapa × su probabilidad de cierre (se configura en Ajustes).">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Deals</th>
                  <th>Valor</th>
                  <th>Prob.</th>
                  <th>Ponderado</th>
                </tr>
              </thead>
              <tbody>
                {m.forecast.byStage.map((r) => (
                  <tr key={r.stage}>
                    <td data-label="Etapa">{r.name}</td>
                    <td data-label="Deals">{r.count}</td>
                    <td data-label="Valor" className="num">
                      {formatMoney(r.value)}
                    </td>
                    <td data-label="Prob.">{r.probability} %</td>
                    <td data-label="Ponderado" className="num">
                      {formatMoney(r.weighted)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td data-label="Etapa">
                    <strong>Total</strong>
                  </td>
                  <td data-label="Deals">
                    <strong>{s.openCount}</strong>
                  </td>
                  <td data-label="Valor" className="num">
                    <strong>{formatMoney(s.openValue)}</strong>
                  </td>
                  <td data-label="Prob." />
                  <td data-label="Ponderado" className="num">
                    <strong>{formatMoney(m.forecast.weighted)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Esperado este mes (ponderado): <strong>{formatMoney(m.forecast.expectedThisMonth)}</strong>
            {m.forecast.overdueExpected > 0 && (
              <>
                {' · '}
                <span className="text-danger">{m.forecast.overdueExpected} con fecha de cierre ya vencida</span>
              </>
            )}
          </p>
        </Block>

        <Block title="Por qué se pierden" hint="Deals perdidos en el periodo, por motivo.">
          {m.lostReasons.length === 0 ? (
            <EmptyState title="Sin deals perdidos" description="No hay deals perdidos en este periodo." />
          ) : (
            <ul className="bar-list">
              {m.lostReasons.map((r) => (
                <li key={r.reasonId ?? 'none'}>
                  <span className="bar-list-label">{r.name}</span>
                  <HBar ratio={r.count / maxReason} />
                  <span className="bar-list-value">
                    {r.count} · {formatMoney(r.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      <div className="grid-2">
        <Block title="Qué origen trae mejores clientes" hint="Deals creados en el periodo, por origen del lead.">
          {m.bySource.length === 0 ? (
            <EmptyState title="Sin datos" description="Indica el origen al crear un deal para compararlos." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Origen</th>
                    <th>Deals</th>
                    <th>Ganados</th>
                    <th>Conversión</th>
                    <th>Vendido</th>
                  </tr>
                </thead>
                <tbody>
                  {m.bySource.map((r) => (
                    <tr key={r.sourceId ?? 'none'}>
                      <td data-label="Origen">{r.name}</td>
                      <td data-label="Deals">{r.deals}</td>
                      <td data-label="Ganados">{r.won}</td>
                      <td data-label="Conversión">{pct(r.winRate)}</td>
                      <td data-label="Vendido" className="num">
                        {formatMoney(r.wonValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Block>

        <Block title="Deals estancados" hint="Abiertos y sin cambiar de etapa en 30 días o más.">
          {m.stalled.length === 0 ? (
            <EmptyState title="Nada estancado" description="Todos los deals abiertos se han movido en los últimos 30 días." />
          ) : (
            <ul className="activity-list">
              {m.stalled.map((d) => (
                <li key={d.id} className="activity-item">
                  <StageBadge stage={d.stage} />
                  <div className="activity-main">
                    <strong>{d.title}</strong>
                    <span className="muted">
                      {formatMoney(d.value)} · {d.days} días sin moverse
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      <div className="grid-2">
        <Block title="Actividad realizada" hint="Actividades marcadas como completadas en el periodo.">
          {m.activities.completedByType.length === 0 ? (
            <EmptyState title="Sin actividad" description="Aún no hay actividades completadas en este periodo." />
          ) : (
            <ul className="bar-list">
              {m.activities.completedByType.map((t) => (
                <li key={t.type}>
                  <span className="bar-list-label">{ACTIVITY_LABELS[t.type as keyof typeof ACTIVITY_LABELS] ?? t.type}</span>
                  <HBar ratio={t.count / Math.max(1, m.activities.completedByType[0]!.count)} />
                  <span className="bar-list-value">{t.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        {m.byOwner && (
          <Block title="Por vendedor" hint="Rendimiento de cada persona del equipo en el periodo.">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th>Ganado</th>
                    <th>Conversión</th>
                    <th>Pipeline</th>
                    <th>Actividades</th>
                  </tr>
                </thead>
                <tbody>
                  {m.byOwner.map((o) => (
                    <tr key={o.ownerId}>
                      <td data-label="Vendedor">{o.name}</td>
                      <td data-label="Ganado" className="num">
                        {formatMoney(o.wonValue)} <span className="muted small">({o.wonCount})</span>
                      </td>
                      <td data-label="Conversión">{pct(o.winRate)}</td>
                      <td data-label="Pipeline" className="num">
                        {formatMoney(o.openValue)}
                      </td>
                      <td data-label="Actividades">{o.activitiesCompleted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>
        )}
      </div>
    </>
  );
}
