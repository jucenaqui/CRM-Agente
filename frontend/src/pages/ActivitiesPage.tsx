import { useState } from 'react';
import { Link } from 'react-router-dom';
import { activitiesApi } from '../api/endpoints';
import type { Activity } from '../api/types';
import { useList } from '../utils/hooks';
import { PageHeader } from '../components/Badges';
import { SearchInput } from '../components/Form';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Pagination } from '../components/Pagination';
import { ActivityForm } from '../components/forms/ActivityForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ActivityRow } from '../components/ActivityRow';
import { useToast } from '../components/Toast';
import { errorMessage } from '../api/client';
import { useLookups } from '../utils/lookups';

interface Filters {
  completed?: boolean;
}

export function ActivitiesPage() {
  const list = useList<Activity, Filters>((p) => activitiesApi.list(p), {
    initialSort: 'dueDate',
    initialOrder: 'asc',
    initialFilters: { completed: false },
  });
  const [lookupKey, setLookupKey] = useState(0);
  const lookups = useLookups({ contacts: true, deals: true }, lookupKey);
  const toast = useToast();
  const [editing, setEditing] = useState<Activity | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Activity | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const statusValue = list.filters.completed === undefined ? 'all' : list.filters.completed ? 'done' : 'pending';

  const toggle = async (a: Activity) => {
    setTogglingId(a.id);
    try {
      await activitiesApi.setCompleted(a.id, !a.completed);
      toast.success(a.completed ? 'Actividad marcada como pendiente' : 'Actividad completada');
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Actividades"
        subtitle="Llamadas, emails, reuniones, tareas y notas."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setLookupKey((k) => k + 1);
              setFormOpen(true);
            }}
          >
            + Nueva actividad
          </button>
        }
      />
      <div className="card">
        <div className="toolbar">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Buscar actividades…" />
          <div className="segmented" role="group" aria-label="Estado">
            {(
              [
                ['pending', 'Pendientes'],
                ['done', 'Completadas'],
                ['all', 'Todas'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={statusValue === v}
                className={statusValue === v ? 'active' : ''}
                onClick={() => list.setFilters({ completed: v === 'all' ? undefined : v === 'done' })}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            aria-label="Ordenar"
            value={`${list.sort ?? 'dueDate'}:${list.order}`}
            onChange={(e) => {
              const [field = 'dueDate', order] = e.target.value.split(':');
              list.setSortOrder(field, order === 'desc' ? 'desc' : 'asc');
            }}
          >
            <option value="dueDate:asc">Fecha límite ↑</option>
            <option value="dueDate:desc">Fecha límite ↓</option>
            <option value="createdAt:desc">Más recientes</option>
            <option value="createdAt:asc">Más antiguas</option>
          </select>
        </div>
        {list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <Loading />
        ) : list.data && list.data.data.length === 0 ? (
          <EmptyState
            title={list.search ? 'Sin resultados' : statusValue === 'pending' ? '¡Todo al día!' : 'No hay actividades'}
            description={list.search ? 'Prueba con otra búsqueda.' : 'Crea una actividad para hacer seguimiento.'}
          />
        ) : (
          list.data && (
            <>
              <ul className={`activity-list${list.loading ? ' is-loading' : ''}`}>
                {list.data.data.map((a) => (
                  <ActivityRow
                    key={a.id}
                    activity={a}
                    busy={togglingId === a.id}
                    onToggle={toggle}
                    onEdit={(x) => {
                      setEditing(x);
                      setFormOpen(true);
                    }}
                    onDelete={setDeleting}
                    meta={
                      <>
                        {a.contactId != null && (
                          <Link to={`/contacts/${a.contactId}`} className="link-sm">
                            {lookups.contactName(a.contactId)}
                          </Link>
                        )}
                        {a.dealId != null && <span className="muted">Deal: {lookups.dealTitle(a.dealId)}</span>}
                      </>
                    }
                  />
                ))}
              </ul>
              <Pagination page={list.page} pageSize={list.pageSize} total={list.data.total} onChange={list.setPage} />
            </>
          )
        )}
      </div>

      <ActivityForm
        open={formOpen}
        activity={editing}
        contacts={lookups.contacts}
        deals={lookups.deals}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          toast.success(editing ? 'Actividad actualizada' : 'Actividad creada');
          list.reload();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        message={`¿Eliminar la actividad "${deleting?.subject ?? ''}"?`}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await activitiesApi.remove(deleting.id);
          toast.success('Actividad eliminada');
          list.reload();
        }}
      />
    </>
  );
}
