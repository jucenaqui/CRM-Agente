import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListParams, Paginated } from '../api/types';
import { errorMessage } from '../api/client';

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/** Ejecuta una carga asíncrona dependiente de `deps`, descartando respuestas obsoletas. */
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(errorMessage(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload, setData };
}

export interface ListState<T, F> extends AsyncState<Paginated<T>> {
  page: number;
  setPage: (p: number) => void;
  search: string;
  setSearch: (s: string) => void;
  filters: F;
  setFilters: (f: F) => void;
  sort: string | undefined;
  order: 'asc' | 'desc';
  toggleSort: (field: string) => void;
  setSortOrder: (field: string, order: 'asc' | 'desc') => void;
  pageSize: number;
}

/** Estado estándar de un listado paginado con búsqueda, filtros y orden. */
export function useList<T, F extends object = Record<string, never>>(
  fetcher: (params: ListParams & F) => Promise<Paginated<T>>,
  opts: { pageSize?: number; initialFilters?: F; initialSort?: string; initialOrder?: 'asc' | 'desc' } = {},
): ListState<T, F> {
  const pageSize = opts.pageSize ?? 10;
  const [page, setPage] = useState(1);
  const [search, setSearchRaw] = useState('');
  const [filters, setFiltersRaw] = useState<F>((opts.initialFilters ?? {}) as F);
  const [sort, setSort] = useState<string | undefined>(opts.initialSort);
  const [order, setOrder] = useState<'asc' | 'desc'>(opts.initialOrder ?? 'desc');
  const debounced = useDebounced(search, 300);
  const filtersKey = JSON.stringify(filters);

  const state = useAsync(
    () => fetcher({ page, pageSize, search: debounced.trim() || undefined, sort, order, ...filters }),
    [page, pageSize, debounced, sort, order, filtersKey],
  );

  const setSearch = useCallback((s: string) => {
    setSearchRaw(s);
    setPage(1);
  }, []);
  const setFilters = useCallback((f: F) => {
    setFiltersRaw(f);
    setPage(1);
  }, []);
  const toggleSort = useCallback(
    (field: string) => {
      if (sort === field) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
      else {
        setSort(field);
        setOrder('asc');
      }
    },
    [sort],
  );

  const setSortOrder = useCallback((field: string, o: 'asc' | 'desc') => {
    setSort(field);
    setOrder(o);
  }, []);

  // Si al borrar el último elemento la página queda vacía, retrocede una.
  useEffect(() => {
    if (state.data && state.data.data.length === 0 && page > 1 && state.data.total > 0) {
      setPage((p) => Math.max(1, p - 1));
    }
  }, [state.data, page]);

  return { ...state, page, setPage, search, setSearch, filters, setFilters, sort, order, toggleSort, setSortOrder, pageSize };
}
