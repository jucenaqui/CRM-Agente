import { useEffect, useState } from 'react';
import { companiesApi, contactsApi, dealsApi } from '../api/endpoints';
import type { Company, Contact, Deal } from '../api/types';

/** Tamaño máximo pedido para selects (el backend puede limitarlo). */
export const LOOKUP_PAGE_SIZE = 100;

export interface Lookups {
  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
  companyName: (id: number | null | undefined) => string;
  contactName: (id: number | null | undefined) => string;
  dealTitle: (id: number | null | undefined) => string;
}

export function contactFullName(c: Pick<Contact, 'firstName' | 'lastName'>): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

/** Carga listas auxiliares para selects y para resolver nombres en tablas. */
export function useLookups(which: { companies?: boolean; contacts?: boolean; deals?: boolean }, refreshKey = 0): Lookups {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const { companies: wc, contacts: wct, deals: wd } = which;

  useEffect(() => {
    let alive = true;
    const opts = { page: 1, pageSize: LOOKUP_PAGE_SIZE, sort: 'name', order: 'asc' as const };
    if (wc) companiesApi.list(opts).then((r) => alive && setCompanies(r.data)).catch(() => {});
    if (wct)
      contactsApi
        .list({ page: 1, pageSize: LOOKUP_PAGE_SIZE, sort: 'firstName', order: 'asc' })
        .then((r) => alive && setContacts(r.data))
        .catch(() => {});
    if (wd)
      dealsApi
        .list({ page: 1, pageSize: LOOKUP_PAGE_SIZE, sort: 'title', order: 'asc' })
        .then((r) => alive && setDeals(r.data))
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [wc, wct, wd, refreshKey]);

  const companyName = (id: number | null | undefined) => (id == null ? '—' : companies.find((c) => c.id === id)?.name ?? `#${id}`);
  const contactName = (id: number | null | undefined) => {
    if (id == null) return '—';
    const c = contacts.find((x) => x.id === id);
    return c ? contactFullName(c) : `#${id}`;
  };
  const dealTitle = (id: number | null | undefined) => (id == null ? '—' : deals.find((d) => d.id === id)?.title ?? `#${id}`);

  return { companies, contacts, deals, companyName, contactName, dealTitle };
}

/** Convierte el valor de un <select> a id numérico o null. */
export function idOrNull(v: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
