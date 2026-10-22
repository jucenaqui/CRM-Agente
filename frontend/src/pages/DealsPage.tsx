import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { dealsApi } from '../api/endpoints';
import { DEAL_STAGES, type Deal, type DealStage } from '../api/types';
import { useAsync, useList } from '../utils/hooks';
import { PageHeader, SortHeader, StageBadge } from '../components/Badges';
import { SearchInput } from '../components/Form';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Pagination } from '../components/Pagination';
import { DealForm } from '../components/forms/DealForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { errorMessage } from '../api/client';
import { STAGE_LABELS, formatDate, formatMoney } from '../utils/format';
import { LOOKUP_PAGE_SIZE, useLookups, type Lookups } from '../utils/lookups';

interface Filters {
  stage?: DealStage;
}

interface CommonProps {
  lookups: Lookups;
  onEdit: (d: Deal) => void;
  onDelete: (d: Deal) => void;
  refreshKey: number;
}

function DealsTable({ lookups, onEdit, onDelete, refreshKey }: CommonProps) {
  const list = useList<Deal, Filters>((p) => dealsApi.list(p), { initialSort: 'createdAt', initialOrder: 'desc' });
  const { reload } = list;
  useEffect(() => {
    if (refreshKey > 0) reload();
  }, [refreshKey, reload]);

  return (
    <div className="card">
      <div className="toolbar">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Buscar deals…" />
        <select
          aria-label="Filtrar por etapa"
          value={list.filters.stage ?? ''}
          onChange={(e) => list.setFilters({ stage: (e.target.value || undefined) as DealStage | undefined })}
        >
          <option value="">Todas las etapas</option>
          {DEAL_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <Loading />
      ) : list.data && list.data.data.length === 0 ? (
        <EmptyState
          title={list.search || list.filters.stage ? 'Sin resultados' : 'Aún no hay deals'}
          description={list.search || list.filters.stage ? 'Prueba con otros filtros.' : 'Crea tu primera oportunidad.'}
        />
      ) : (
        list.data && (
          <>
            <div className={`table-wrap${list.loading ? ' is-loading' : ''}`}>
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader field="title" label="Título" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                    <SortHeader field="value" label="Valor" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                    <SortHeader field="stage" label="Etapa" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                    <th>Empresa</th>
                    <th>Contacto</th>
                    <SortHeader field="expectedCloseDate" label="Cierre" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                    <th className="col-actions">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((d) => (
                    <tr key={d.id}>
                      <td data-label="Título">
                        <strong>{d.title}</strong>
                      </td>
                      <td data-label="Valor" className="num">
                        {formatMoney(d.value, d.currency)}
                      </td>
                      <td data-label="Etapa">
                        <StageBadge stage={d.stage} />
                      </td>
                      <td data-label="Empresa">
                        {d.companyId != null ? <Link to={`/companies/${d.companyId}`}>{lookups.companyName(d.companyId)}</Link> : '—'}
                      </td>
                      <td data-label="Contacto">
                        {d.contactId != null ? <Link to={`/contacts/${d.contactId}`}>{lookups.contactName(d.contactId)}</Link> : '—'}
                      </td>
                      <td data-label="Cierre">{formatDate(d.expectedCloseDate)}</td>
                      <td className="col-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(d)}>
                          Editar
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => onDelete(d)}>
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.page} pageSize={list.pageSize} total={list.data.total} onChange={list.setPage} />
          </>
        )
      )}
    </div>
  );
}

function DealsKanban({ lookups, onEdit, onDelete, refreshKey }: CommonProps) {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useAsync(
    () => dealsApi.list({ page: 1, pageSize: LOOKUP_PAGE_SIZE, sort: 'updatedAt', order: 'desc' }),
    [refreshKey],
  );
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<DealStage | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);

  const move = async (deal: Deal, stage: DealStage) => {
    if (deal.stage === stage) return;
    const prevStage = deal.stage;
    const patch = (s: DealStage) =>
      setData((prev) => (prev ? { ...prev, data: prev.data.map((x) => (x.id === deal.id ? { ...x, stage: s } : x)) } : prev));
    patch(stage); // actualización optimista
    setMovingId(deal.id);
    try {
      const updated = await dealsApi.moveStage(deal.id, stage);
      if (updated && typeof updated === 'object') {
        setData((prev) => (prev ? { ...prev, data: prev.data.map((x) => (x.id === deal.id ? { ...x, ...updated } : x)) } : prev));
      }
      toast.success(`"${deal.title}" movido a ${STAGE_LABELS[stage]}`);
    } catch (e) {
      patch(prevStage);
      toast.error(errorMessage(e));
    } finally {
      setMovingId(null);
    }
  };

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const deals = data.data;
  return (
    <>
      {data.total > deals.length && (
        <p className="muted small">
          Mostrando {deals.length} de {data.total} deals (los más recientes). Usa la vista de lista para ver todos.
        </p>
      )}
      <div className="kanban" role="list" aria-label="Pipeline de deals">
        {DEAL_STAGES.map((stage, idx) => {
          const items = deals.filter((d) => d.stage === stage);
          const total = items.reduce((a, d) => a + (Number(d.value) || 0), 0);
          return (
            <section
              key={stage}
              role="listitem"
              aria-label={`Etapa ${STAGE_LABELS[stage]}`}
              className={`kanban-col${overStage === stage ? ' is-over' : ''}`}
              onDragOver={(e) => {
                if (dragId == null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overStage !== stage) setOverStage(stage);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverStage(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOverStage(null);
                const id = Number(e.dataTransfer.getData('text/plain')) || dragId;
                const deal = deals.find((d) => d.id === id);
                setDragId(null);
                if (deal) void move(deal, stage);
              }}
            >
              <header className={`kanban-head stage-border-${stage}`}>
                <div>
                  <h3>{STAGE_LABELS[stage]}</h3>
                  <span className="muted small">{formatMoney(total)}</span>
                </div>
                <span className="count-pill">{items.length}</span>
              </header>
              <div className="kanban-body">
                {items.length === 0 && <p className="kanban-empty">Arrastra deals aquí</p>}
                {items.map((d) => (
                  <article
                    key={d.id}
                    className={`kanban-card${dragId === d.id ? ' is-dragging' : ''}${movingId === d.id ? ' is-moving' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      setDragId(d.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(d.id));
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                  >
                    <div className="kanban-card-title">
                      <strong>{d.title}</strong>
                    </div>
                    <div className="kanban-card-value">{formatMoney(d.value, d.currency)}</div>
                    <div className="muted small">
                      {[d.companyId != null ? lookups.companyName(d.companyId) : null, d.contactId != null ? lookups.contactName(d.contactId) : null]
                        .filter(Boolean)
                        .join(' · ') || 'Sin asociar'}
                    </div>
                    {d.expectedCloseDate && <div className="muted small">Cierre: {formatDate(d.expectedCloseDate)}</div>}
                    <div className="kanban-card-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        disabled={idx === 0 || movingId === d.id}
                        onClick={() => move(d, DEAL_STAGES[idx - 1]!)}
                        aria-label={`Mover "${d.title}" a la etapa anterior`}
                        title="Etapa anterior"
                      >
                        ‹
                      </button>
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => onEdit(d)}>
                        Editar
                      </button>
                      <button type="button" className="btn btn-ghost btn-xs text-danger" onClick={() => onDelete(d)}>
                        Eliminar
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        disabled={idx === DEAL_STAGES.length - 1 || movingId === d.id}
                        onClick={() => move(d, DEAL_STAGES[idx + 1]!)}
                        aria-label={`Mover "${d.title}" a la etapa siguiente`}
                        title="Etapa siguiente"
                      >
                        ›
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

export function DealsPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'kanban' ? 'kanban' : 'list';
  const lookups = useLookups({ companies: true, contacts: true });
  const toast = useToast();
  const [editing, setEditing] = useState<Deal | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Deal | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  const common: CommonProps = {
    lookups,
    refreshKey,
    onEdit: (d) => {
      setEditing(d);
      setFormOpen(true);
    },
    onDelete: setDeleting,
  };

  return (
    <>
      <PageHeader
        title="Deals"
        subtitle="Oportunidades de venta y su avance en el pipeline."
        actions={
          <>
            <div className="segmented" role="tablist" aria-label="Vista">
              <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setParams({}, { replace: true })}>
                Lista
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'kanban'}
                className={view === 'kanban' ? 'active' : ''}
                onClick={() => setParams({ view: 'kanban' }, { replace: true })}
              >
                Kanban
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              + Nuevo deal
            </button>
          </>
        }
      />
      {view === 'list' ? <DealsTable {...common} /> : <DealsKanban {...common} />}

      <DealForm
        open={formOpen}
        deal={editing}
        companies={lookups.companies}
        contacts={lookups.contacts}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          toast.success(editing ? 'Deal actualizado' : 'Deal creado');
          refresh();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        message={`¿Eliminar el deal "${deleting?.title ?? ''}"? Esta acción no se puede deshacer.`}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await dealsApi.remove(deleting.id);
          toast.success('Deal eliminado');
          refresh();
        }}
      />
    </>
  );
}
