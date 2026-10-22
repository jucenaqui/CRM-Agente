import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses `data` with `schema`, throwing a 400 VALIDATION_ERROR in the contract format. */
export function validate<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const details = r.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    }));
    throw badRequest('Invalid request data', details);
  }
  return r.data;
}

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const reqText = (max = 200) => z.string().trim().min(1).max(max);

export const optText = (max = 200) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional();

export const optEmail = () =>
  z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toLowerCase()) : v),
    z.email().max(254).nullable(),
  ).optional();

export const optUrl = () =>
  z
    .preprocess(
      (v) => {
        const n = emptyToNull(v);
        // Accept bare domains ("acme.com") by assuming https; other schemes are still rejected.
        if (typeof n === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(n.trim())) return `https://${n.trim()}`;
        return n;
      },
      z
        .string()
        .trim()
        .max(500)
        .refine((v) => {
          try {
            const u = new URL(v);
            return u.protocol === 'http:' || u.protocol === 'https:';
          } catch {
            return false;
          }
        }, 'Must be an http(s) URL')
        .nullable(),
    )
    .optional();

export const optId = () =>
  z
    .preprocess(
      (v) => (v === '' ? null : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v),
      z.number().int().positive().nullable(),
    )
    .optional();

export const optDate = () =>
  z
    .preprocess(
      emptyToNull,
      z
        .string()
        .max(40)
        .refine((v) => !Number.isNaN(Date.parse(v)), 'Must be an ISO 8601 date')
        .transform((v) => new Date(v).toISOString())
        .nullable(),
    )
    .optional();

export const money = () =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v),
    z.number().finite().nonnegative().max(1e13),
  );

export const boolish = () =>
  z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());

export const email = () => z.string().trim().toLowerCase().pipe(z.email().max(254));
export const password = () => z.string().min(8).max(128);

export interface ListParams {
  page: number;
  pageSize: number;
  search?: string;
  sort?: string;
  order: 'asc' | 'desc';
}

const intOr = (fallback: number) => (v: unknown) => {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : v;
};

export const MAX_PAGE_SIZE = 100;

const listSchema = z.object({
  page: z.preprocess(intOr(1), z.number().int()).transform((n) => Math.max(1, n)),
  pageSize: z
    .preprocess(intOr(20), z.number().int())
    .transform((n) => Math.min(MAX_PAGE_SIZE, Math.max(1, n))),
  search: z.string().trim().max(200).optional(),
  sort: z.string().optional(),
  order: z.preprocess(
    (v) => (typeof v === 'string' && v !== '' ? v.toLowerCase() : 'desc'),
    z.enum(['asc', 'desc']),
  ),
});

/** Parses common list query params. `sort` is validated against `sortable` (whitelist). */
export function parseList(query: Record<string, unknown>, sortable: readonly string[]): ListParams {
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const p = validate(listSchema, {
    page: first(query.page),
    pageSize: first(query.pageSize),
    search: first(query.search),
    sort: first(query.sort) || undefined,
    order: first(query.order),
  });
  if (p.sort !== undefined && !sortable.includes(p.sort)) {
    throw badRequest(`Invalid sort field. Allowed: ${sortable.join(', ')}`, { allowed: sortable });
  }
  return { ...p, search: p.search || undefined };
}

/** Escapes LIKE wildcards; use with `ESCAPE '\'` in SQL. */
export const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
