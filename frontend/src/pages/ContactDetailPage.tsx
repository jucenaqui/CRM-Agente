import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { activitiesApi, contactsApi, dealsApi } from '../api/endpoints';
import type { Activity } from '../api/types';
import { useAsync } from '../utils/hooks';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { PageHeader, StageBadge } from '../components/Badges';
import { ContactForm } from '../components/forms/ContactForm';
import { ActivityForm } from '../components/forms/ActivityForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ActivityRow } from '../components/ActivityRow';
import { useToast } from '../components/Toast';
import { errorMessage } from '../api/client';
import { formatDate, formatMoney } from '../utils/format';
import { contactFullName, useLookups } from '../utils/lookups';

export function ContactDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const toast = useToast();
  const contact = useAsync(() => contactsApi.get(id), [id]);
  const activities = useAsync(
    () => activitiesApi.list({ contactId: id, page: 1, pageSize: 100, sort: 'dueDate', order: 'asc' }),
    [id],
  );
  const deals = useAsync(() => dealsApi.list({ contactId: id, page: 1, pageSize: 100 }), [id]);
  const lookups = useLookups({ companies: true, contacts: true, deals: true });

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [deletingActivity, setDeletingActivity] = useState<Activity | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  if (!Number.isFinite(id)) return <ErrorState message="Identificador inválido" />;
  if (contact.loading && !contact.data) return <Loading />;
  if (contact.error || !contact.data) return <ErrorState message={contact.error ?? 'No encontrado'} onRetry={contact.reload} />;

  const c = contact.data;
  const name = contactFullName(c);

  const toggle = async (a: Activity) => {
    setTogglingId(a.id);
    try {
      const updated = await activitiesApi.setCompleted(a.id, !a.completed);
      activities.setData((prev) =>
        prev ? { ...prev, data: prev.data.map((x) => (x.id === a.id ? { ...x, ...updated, completed: !a.completed } : x)) } : prev,
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <>
      <nav className="breadcrumbs" aria-label="Migas de pan">
        <Link to="/contacts">Contactos</Link> <span aria-hidden="true">/</span> <span>{name}</span>
      </nav>
      <PageHeader
        title={name}
        subtitle={[c.position, c.companyId != null ? lookups.companyName(c.companyId) : null].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(true)}>
              Editar
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setDeleteOpen(true)}>
              Eliminar
            </button>
          </>
        }
      />
      <div className="grid-detail">
        <div className="stack">
          <section className="card">
            <h2 className="card-title">Información</h2>
            <dl className="details">
              <dt>Email</dt>
              <dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</dd>
              <dt>Teléfono</dt>
              <dd>{c.phone || '—'}</dd>
              <dt>Cargo</dt>
              <dd>{c.position || '—'}</dd>
              <dt>Empresa</dt>
              <dd>{c.companyId != null ? <Link to={`/companies/${c.companyId}`}>{lookups.companyName(c.companyId)}</Link> : '—'}</dd>
              <dt>Creado</dt>
              <dd>{formatDate(c.createdAt)}</dd>
            </dl>
          </section>
          <section className="card">
            <h2 className="card-title">Deals</h2>
            {deals.error ? (
              <ErrorState message={deals.error} onRetry={deals.reload} />
            ) : deals.loading && !deals.data ? (
              <Loading />
            ) : !deals.data?.data.length ? (
              <EmptyState title="Sin deals asociados" />
            ) : (
              <ul className="simple-list">
                {deals.data.data.map((d) => (
                  <li key={d.id}>
                    <span>
                      <strong>{d.title}</strong> <StageBadge stage={d.stage} />
                    </span>
                    <span className="muted">{formatMoney(d.value, d.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="card">
          <div className="card-title-row">
            <h2 className="card-title">Actividades</h2>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditingActivity(null);
                setActivityOpen(true);
              }}
            >
              + Nueva actividad
            </button>
          </div>
          {activities.error ? (
            <ErrorState message={activities.error} onRetry={activities.reload} />
          ) : activities.loading && !activities.data ? (
            <Loading />
          ) : !activities.data?.data.length ? (
            <EmptyState title="Sin actividades" description="Registra llamadas, reuniones o tareas con este contacto." />
          ) : (
            <ul className="activity-list">
              {activities.data.data.map((a) => (
                <ActivityRow
                  key={a.id}
                  activity={a}
                  busy={togglingId === a.id}
                  onToggle={toggle}
                  onEdit={(x) => {
                    setEditingActivity(x);
                    setActivityOpen(true);
                  }}
                  onDelete={setDeletingActivity}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <ContactForm
        open={editOpen}
        contact={c}
        companies={lookups.companies}
        onClose={() => setEditOpen(false)}
        onSaved={(saved) => {
          contact.setData(saved);
          toast.success('Contacto actualizado');
        }}
      />
      <ActivityForm
        open={activityOpen}
        activity={editingActivity}
        contacts={lookups.contacts}
        deals={lookups.deals}
        defaults={{ contactId: c.id }}
        onClose={() => setActivityOpen(false)}
        onSaved={() => {
          toast.success(editingActivity ? 'Actividad actualizada' : 'Actividad creada');
          activities.reload();
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        message={`¿Eliminar a "${name}"? Esta acción no se puede deshacer.`}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await contactsApi.remove(c.id);
          toast.success('Contacto eliminado');
          navigate('/contacts', { replace: true });
        }}
      />
      <ConfirmDialog
        open={deletingActivity !== null}
        message={`¿Eliminar la actividad "${deletingActivity?.subject ?? ''}"?`}
        onClose={() => setDeletingActivity(null)}
        onConfirm={async () => {
          if (!deletingActivity) return;
          await activitiesApi.remove(deletingActivity.id);
          toast.success('Actividad eliminada');
          activities.reload();
        }}
      />
    </>
  );
}
