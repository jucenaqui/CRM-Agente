import { useState } from 'react';
import { Link } from 'react-router-dom';
import { contactsApi } from '../api/endpoints';
import type { Contact } from '../api/types';
import { useList } from '../utils/hooks';
import { PageHeader, SortHeader } from '../components/Badges';
import { SearchInput } from '../components/Form';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Pagination } from '../components/Pagination';
import { ContactForm } from '../components/forms/ContactForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { contactFullName, useLookups } from '../utils/lookups';

interface Filters {
  companyId?: number;
}

export function ContactsPage() {
  const list = useList<Contact, Filters>((p) => contactsApi.list(p), { initialSort: 'createdAt', initialOrder: 'desc' });
  const lookups = useLookups({ companies: true });
  const toast = useToast();
  const [editing, setEditing] = useState<Contact | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  return (
    <>
      <PageHeader
        title="Contactos"
        subtitle="Personas con las que te relacionas."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            + Nuevo contacto
          </button>
        }
      />
      <div className="card">
        <div className="toolbar">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Buscar contactos…" />
          <select
            aria-label="Filtrar por empresa"
            value={list.filters.companyId ?? ''}
            onChange={(e) => list.setFilters({ companyId: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">Todas las empresas</option>
            {lookups.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
            title={list.search || list.filters.companyId ? 'Sin resultados' : 'Aún no hay contactos'}
            description={list.search || list.filters.companyId ? 'Prueba con otros filtros.' : 'Crea tu primer contacto.'}
          />
        ) : (
          list.data && (
            <>
              <div className={`table-wrap${list.loading ? ' is-loading' : ''}`}>
                <table className="table">
                  <thead>
                    <tr>
                      <SortHeader field="firstName" label="Nombre" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                      <SortHeader field="email" label="Email" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                      <th>Teléfono</th>
                      <th>Cargo</th>
                      <th>Empresa</th>
                      <th className="col-actions">
                        <span className="sr-only">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.data.map((c) => (
                      <tr key={c.id}>
                        <td data-label="Nombre">
                          <Link to={`/contacts/${c.id}`} className="strong-link">
                            {contactFullName(c)}
                          </Link>
                        </td>
                        <td data-label="Email">{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</td>
                        <td data-label="Teléfono">{c.phone || '—'}</td>
                        <td data-label="Cargo">{c.position || '—'}</td>
                        <td data-label="Empresa">
                          {c.companyId != null ? <Link to={`/companies/${c.companyId}`}>{lookups.companyName(c.companyId)}</Link> : '—'}
                        </td>
                        <td className="col-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setEditing(c);
                              setFormOpen(true);
                            }}
                          >
                            Editar
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setDeleting(c)}>
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

      <ContactForm
        open={formOpen}
        contact={editing}
        companies={lookups.companies}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          toast.success(editing ? 'Contacto actualizado' : 'Contacto creado');
          list.reload();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        message={`¿Eliminar a "${deleting ? contactFullName(deleting) : ''}"? Esta acción no se puede deshacer.`}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await contactsApi.remove(deleting.id);
          toast.success('Contacto eliminado');
          list.reload();
        }}
      />
    </>
  );
}
