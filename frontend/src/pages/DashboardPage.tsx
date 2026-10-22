import { Link } from 'react-router-dom';
import { dashboardApi } from '../api/endpoints';
import { DEAL_STAGES, type DashboardStats } from '../api/types';
import { useAsync } from '../utils/hooks';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { ActivityTypeBadge, PageHeader } from '../components/Badges';
import { STAGE_LABELS, formatDateTime, formatMoney, isOverdue } from '../utils/format';
import { useAuth } from '../auth/AuthContext';

function Kpi({ label, value, to, accent }: { label: string; value: string; to?: string; accent?: string }) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
    </>
  );
  return to ? (
    <Link to={to} className={`card kpi ${accent ?? ''}`}>
      {body}
    </Link>
  ) : (
    <div className={`card kpi ${accent ?? ''}`}>{body}</div>
  );
}

function Funnel({ stats }: { stats: DashboardStats }) {
  const byStage = new Map(stats.dealsByStage.map((s) => [s.stage, s]));
  const rows = DEAL_STAGES.map((stage) => byStage.get(stage) ?? { stage, count: 0, value: 0 });
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const totalCount = rows.reduce((a, r) => a + r.count, 0);

  if (totalCount === 0) {
    return <EmptyState title="Sin deals todavía" description="Crea tu primer deal para ver el embudo." action={<Link className="btn btn-primary btn-sm" to="/deals">Ir a deals</Link>} />;
  }

  return (
    <ul className="funnel" aria-label="Deals por etapa">
      {rows.map((r) => {
        const pct = Math.round((r.count / maxCount) * 100);
        return (
          <li key={r.stage} className="funnel-row">
            <span className="funnel-label">{STAGE_LABELS[r.stage]}</span>
            <div
              className="funnel-track"
              role="meter"
              aria-label={`${STAGE_LABELS[r.stage]}: ${r.count} deals`}
              aria-valuemin={0}
              aria-valuemax={maxCount}
              aria-valuenow={r.count}
            >
              <div className={`funnel-bar stage-bg-${r.stage}`} style={{ width: `${Math.max(pct, r.count > 0 ? 4 : 0)}%` }} />
            </div>
            <span className="funnel-count">{r.count}</span>
            <span className="funnel-value muted">{formatMoney(r.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(() => dashboardApi.stats(), []);

  return (
    <>
      <PageHeader title="Dashboard" subtitle={user ? `Hola, ${user.name}. Este es el resumen de tu actividad.` : undefined} />
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          <section className="kpi-grid" aria-label="Indicadores">
            <Kpi label="Empresas" value={String(data.totals.companies)} to="/companies" />
            <Kpi label="Contactos" value={String(data.totals.contacts)} to="/contacts" />
            <Kpi label="Deals" value={String(data.totals.deals)} to="/deals" />
            <Kpi label="Pipeline abierto" value={formatMoney(data.totals.openDealsValue)} accent="kpi-blue" />
            <Kpi label="Ganado" value={formatMoney(data.totals.wonDealsValue)} accent="kpi-green" />
          </section>
          <div className="grid-2">
            <section className="card">
              <h2 className="card-title">Embudo por etapa</h2>
              <Funnel stats={data} />
            </section>
            <section className="card">
              <div className="card-title-row">
                <h2 className="card-title">Próximas actividades</h2>
                <Link to="/activities" className="link-sm">
                  Ver todas
                </Link>
              </div>
              {data.upcomingActivities.length === 0 ? (
                <EmptyState title="Nada pendiente" description="No hay actividades próximas." />
              ) : (
                <ul className="activity-list">
                  {data.upcomingActivities.map((a) => (
                    <li key={a.id} className="activity-item">
                      <ActivityTypeBadge type={a.type} />
                      <div className="activity-main">
                        <strong>{a.subject}</strong>
                        <span className={isOverdue(a.dueDate, a.completed) ? 'text-danger' : 'muted'}>{formatDateTime(a.dueDate)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
