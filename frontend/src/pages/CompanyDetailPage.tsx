import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { companiesApi, contactsApi, dealsApi } from '../api/endpoints';
import { useAsync } from '../utils/hooks';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { PageHeader, StageBadge } from '../components/Badges';
import { CompanyForm } from '../components/forms/CompanyForm';
import { ContactForm } from '../components/forms/ContactForm';
import { DealForm } from '../components/forms/DealForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { formatDate, formatMoney, safeUrl } from '../utils/format';
import { contactFullName, useLookups } from '../utils/lookups';

export function CompanyDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const toast = useToast();
  const company = useAsync(() => companiesApi.get(id), [id]);
  const contacts = useAsync(() => contactsApi.list({ companyId: id, pageSize: 100, page: 1 }), [id]);
  const deals = useAsync(() => dealsApi.list({ companyId: id, pageSize: 100, page: 1 }), [id]);
  const lookups = useLookups({ companies: true, contacts: true });
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);

  if (!Number.isFinite(id)) return <ErrorState message="Identificador inválido" />;
  if (company.loading && !company.data) return <Loading />;
  if (company.error || !company.data) return <ErrorState message={company.error ?? 'No encontrada'} onRetry={company.reload} />;

  const c = company.data;
  const url = safeUrl(c.website);

  return (
    <>
      <nav className="breadcrumbs" aria-label="Migas de pan">
        <Link to="/companies">Empresas</Link> <span aria-hidden="true">/</span> <span>{c.name}</span>
      </nav>
      <PageHeader
        title={c.name}
        subtitle={c.industry ?? undefined}
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
      <div className="grid-3">
        <section className="card">
          <h2 className="card-title">Información</h2>
          <dl className="details">
            <dt>Industria</dt>
            <dd>{c.industry || '—'}</dd>
            <dt>Sitio web</dt>
            <dd>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {c.website}
                </a>
              ) : (
                c.website || '—'
              )}
            </dd>
            <dt>Teléfono</dt>
            <dd>{c.phone || '—'}</dd>
            <dt>Dirección</dt>
            <dd>{c.address || '—'}</dd>
            <dt>Creada</dt>
            <dd>{formatDate(c.createdAt)}</dd>
            <dt>Actualizada</dt>
            <dd>{formatDate(c.updatedAt)}</dd>
          </dl>
        </section>

        <section className="card">
          <div className="card-title-row">
            <h2 className="card-title">Contactos</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setContactOpen(true)}>
              + Añadir
            </button>
          </div>
          {contacts.error ? (
            <ErrorState message={contacts.error} onRetry={contacts.reload} />
          ) : contacts.loading && !contacts.data ? (
            <Loading />
          ) : !contacts.data?.data.length ? (
            <EmptyState title="Sin contactos" />
          ) : (
            <ul className="simple-list">
              {contacts.data.data.map((ct) => (
                <li key={ct.id}>
                  <Link to={`/contacts/${ct.id}`} className="strong-link">
                    {contactFullName(ct)}
                  </Link>
                  <span className="muted">{ct.position || ct.email || ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-title-row">
            <h2 className="card-title">Deals</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDealOpen(true)}>
              + Añadir
            </button>
          </div>
          {deals.error ? (
            <ErrorState message={deals.error} onRetry={deals.reload} />
          ) : deals.loading && !deals.data ? (
            <Loading />
          ) : !deals.data?.data.length ? (
            <EmptyState title="Sin deals" />
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

      <CompanyForm
        open={editOpen}
        company={c}
        onClose={() => setEditOpen(false)}
        onSaved={(saved) => {
          company.setData(saved);
          toast.success('Empresa actualizada');
        }}
      />
      <ContactForm
        open={contactOpen}
        companies={lookups.companies}
        defaultCompanyId={c.id}
        onClose={() => setContactOpen(false)}
        onSaved={() => {
          toast.success('Contacto creado');
          contacts.reload();
        }}
      />
      <DealForm
        open={dealOpen}
        companies={lookups.companies}
        contacts={lookups.contacts}
        defaults={{ companyId: c.id }}
        onClose={() => setDealOpen(false)}
        onSaved={() => {
          toast.success('Deal creado');
          deals.reload();
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        message={`¿Eliminar la empresa "${c.name}"? Esta acción no se puede deshacer.`}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await companiesApi.remove(c.id);
          toast.success('Empresa eliminada');
          navigate('/companies', { replace: true });
        }}
      />
    </>
  );
}
