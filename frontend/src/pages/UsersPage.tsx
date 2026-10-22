import { useState } from 'react';
import { usersApi } from '../api/endpoints';
import type { User } from '../api/types';
import { useList } from '../utils/hooks';
import { PageHeader, SortHeader } from '../components/Badges';
import { SearchInput } from '../components/Form';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Pagination } from '../components/Pagination';
import { UserForm } from '../components/forms/UserForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS, formatDate } from '../utils/format';

export function UsersPage() {
  const { user: me } = useAuth();
  const list = useList<User>((p) => usersApi.list(p), { initialSort: 'createdAt', initialOrder: 'asc' });
  const toast = useToast();
  const [editing, setEditing] = useState<User | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<User | null>(null);

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle="Gestiona el equipo y sus permisos."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            + Nuevo usuario
          </button>
        }
      />
      <div className="card">
        <div className="toolbar">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Buscar usuarios…" />
        </div>
        {list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <Loading />
        ) : list.data && list.data.data.length === 0 ? (
          <EmptyState title="Sin resultados" />
        ) : (
          list.data && (
            <>
              <div className={`table-wrap${list.loading ? ' is-loading' : ''}`}>
                <table className="table">
                  <thead>
                    <tr>
                      <SortHeader field="name" label="Nombre" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                      <SortHeader field="email" label="Email" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                      <SortHeader field="role" label="Rol" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                      <SortHeader field="createdAt" label="Alta" sort={list.sort} order={list.order} onSort={list.toggleSort} />
                      <th className="col-actions">
                        <span className="sr-only">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.data.map((u) => (
                      <tr key={u.id}>
                        <td data-label="Nombre">
                          <strong>{u.name}</strong> {u.id === me?.id && <span className="muted small">(tú)</span>}
                        </td>
                        <td data-label="Email">{u.email}</td>
                        <td data-label="Rol">
                          <span className={`badge role-${u.role}`}>{ROLE_LABELS[u.role]}</span>
                        </td>
                        <td data-label="Alta">{formatDate(u.createdAt)}</td>
                        <td className="col-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setEditing(u);
                              setFormOpen(true);
                            }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm text-danger"
                            disabled={u.id === me?.id}
                            title={u.id === me?.id ? 'No puedes eliminar tu propio usuario' : undefined}
                            onClick={() => setDeleting(u)}
                          >
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

      <UserForm
        open={formOpen}
        user={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          toast.success(editing ? 'Usuario actualizado' : 'Usuario creado');
          list.reload();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        message={`¿Eliminar al usuario "${deleting?.name ?? ''}"? Esta acción no se puede deshacer.`}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await usersApi.remove(deleting.id);
          toast.success('Usuario eliminado');
          list.reload();
        }}
      />
    </>
  );
}
