import { useState } from 'react';
import { Link } from 'react-router-dom';
import { companiesApi } from '../api/endpoints';
import type { Company } from '../api/types';
import { useList } from '../utils/hooks';
import { PageHeader, SortHeader } from '../components/Badges';
import { SearchInput } from '../components/Form';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Pagination } from '../components/Pagination';
import { CompanyForm } from '../components/forms/CompanyForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { formatDate, safeUrl } from '../utils/format';

export function CompaniesPage() {
  const list = useList<Company>((p) => companiesApi.list(p), { initialSort: 'createdAt', initialOrder: 'desc' });
  const toast = useToast();
  const [editing, setEditing] = useState<Company | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Company | null>(null);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Empresas"
        subtitle="Cuentas y organizaciones con las que trabajas."
        actions={
          <button type="button" className="btn btn-primary" onClick={openNew}>
            + Nueva empresa
          </button>
        }
      />
      <div className="card">
        <div className="toolbar">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Buscar empresas…" />
        </div>
        {list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <Loading />
        ) : list.data && list.data.data.length === 0 ? (
          <EmptyState
            title={list.search ? 'Sin resultados' : 'Aún no hay empresas'}
            description={list.search ? 'Prueba con otra búsqueda.' : 'Crea la primera empresa para empezar.'}
          />
        ) : (
          list.data && (
            <>
              <div className={`table-wrap${list.loading ? ' is-loading' : ''}`}>
                <table className="table">
                  <thead>
                    <tr>
                      <SortHeader field="name" label="Nombre" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                      <SortHeader field="industry" label="Industria" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                      <th>Web</th>
                      <th>Teléfono</th>
                      <SortHeader field="createdAt" label="Creada" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                      <th className="col-actions">
                        <span className="sr-only">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.data.map((c) => {
                      const url = safeUrl(c.website);
                      return (
                        <tr key={c.id}>
                          <td data-label="Nombre">
                            <Link to={`/companies/${c.id}`} className="strong-link">
                              {c.name}
                            </Link>
                          </td>
                          <td data-label="Industria">{c.industry || '—'}</td>
                          <td data-label="Web">
                            {url ? (
                              <a href={url} target="_blank" rel="noopener noreferrer">
                                {c.website}
                              </a>
                            ) : (
                              c.website || '—'
                            )}
                          </td>
                          <td data-label="Teléfono">{c.phone || '—'}</td>
                          <td data-label="Creada">{formatDate(c.createdAt)}</td>
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
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={list.page} pageSize={list.pageSize} total={list.data.total} onChange={list.setPage} />
            </>
          )
        )}
      </div>

      <CompanyForm
        open={formOpen}
        company={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          toast.success(editing ? 'Empresa actualizada' : 'Empresa creada');
          list.reload();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        message={`¿Eliminar la empresa "${deleting?.name ?? ''}"? Esta acción no se puede deshacer.`}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await companiesApi.remove(deleting.id);
          toast.success('Empresa eliminada');
          list.reload();
        }}
      />
    </>
  );
}
