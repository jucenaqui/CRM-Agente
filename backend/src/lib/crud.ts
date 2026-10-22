import { Router, type Request } from 'express';
import { z } from 'zod';
import { getDb, nowIso } from '../db.js';
import { currentUser, isAdmin } from './auth.js';
import { badRequest, notFound, unprocessable } from './errors.js';
import { likePattern, parseList, validate } from './validation.js';

export type Row = Record<string, unknown>;

export interface FilterDef {
  /** Query-string parameter name. */
  param: string;
  /** Column it filters (trusted, defined in code). */
  column: string;
  kind: 'id' | 'bool' | 'enum';
  /** Allowed values; a function is evaluated per request (for lists that can change, e.g. pipeline stages). */
  values?: readonly string[] | (() => readonly string[]);
}

export interface RefDef {
  /** Body field holding the referenced id. */
  field: string;
  /** Referenced table (trusted, defined in code). */
  table: string;
}

export interface EntityConfig {
  table: string;
  searchColumns: readonly string[];
  sortColumns: readonly string[];
  defaultSort?: string;
  filters?: readonly FilterDef[];
  refs?: readonly RefDef[];
  createSchema: z.ZodType;
  updateSchema: z.ZodType;
  defaults?: Row | (() => Row);
  hasUpdatedAt: boolean;
  mapRow?: (row: Row) => Row;
  /** Extra column values derived when a record is created (e.g. a close date). May throw to reject. */
  onCreate?: (data: Row) => Row;
  /** Extra column values derived when a record changes; `existing` is the stored row before the change. */
  onUpdate?: (data: Row, existing: Row) => Row;
  /** Called after the row is stored (e.g. to write history). */
  afterCreate?: (row: Row, req: Request) => void;
  afterUpdate?: (before: Row, after: Row, req: Request) => void;
}

export const parseIdParam = (raw: unknown): number => {
  const s = String(raw);
  if (!/^\d+$/.test(s)) throw notFound();
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1) throw notFound();
  return n;
};

const parseFilterValue = (f: FilterDef, raw: unknown): unknown => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === undefined || v === '') return undefined;
  const s = String(v);
  if (f.kind === 'id') {
    if (!/^\d+$/.test(s)) throw badRequest(`Invalid ${f.param} filter`);
    return Number(s);
  }
  if (f.kind === 'bool') {
    if (['true', '1'].includes(s)) return 1;
    if (['false', '0'].includes(s)) return 0;
    throw badRequest(`Invalid ${f.param} filter (true|false)`);
  }
  const allowed = typeof f.values === 'function' ? f.values() : f.values;
  if (!allowed?.includes(s)) throw badRequest(`Invalid ${f.param} filter`, { allowed });
  return s;
};

/** Ensures referenced records exist and (for sales users) belong to the caller. */
export function checkRefs(req: Request, refs: readonly RefDef[] | undefined, data: Row): void {
  if (!refs) return;
  const db = getDb();
  const user = currentUser(req);
  for (const ref of refs) {
    const id = data[ref.field];
    if (id === undefined || id === null) continue;
    const row = db.prepare(`SELECT id, ownerId FROM ${ref.table} WHERE id = ?`).get(id) as
      | { id: number; ownerId: number }
      | undefined;
    if (!row || (!isAdmin(req) && row.ownerId !== user.id)) {
      throw unprocessable(`Referenced ${ref.field} does not exist`, 'INVALID_REFERENCE', {
        field: ref.field,
      });
    }
  }
}

export function buildCrud(cfg: EntityConfig) {
  const map = cfg.mapRow ?? ((r: Row) => r);

  /** Returns the row if visible to the caller, else throws 404 (no existence leak). */
  const findOwned = (req: Request, id: number): Row => {
    const user = currentUser(req);
    const row = isAdmin(req)
      ? getDb().prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(id)
      : getDb().prepare(`SELECT * FROM ${cfg.table} WHERE id = ? AND ownerId = ?`).get(id, user.id);
    if (!row) throw notFound();
    return row as Row;
  };

  const getMapped = (id: number): Row =>
    map(getDb().prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(id) as Row);

  const update = (req: Request, id: number, data: Row): Row => {
    const existing = findOwned(req, id);
    checkRefs(req, cfg.refs, data);
    const fields = toSqlValues({ ...data, ...(cfg.onUpdate?.(data, existing) ?? {}) });
    if (cfg.hasUpdatedAt) fields.updatedAt = nowIso();
    const keys = Object.keys(fields);
    if (keys.length > 0) {
      const sets = keys.map((k) => `${k} = @${k}`).join(', ');
      getDb()
        .prepare(`UPDATE ${cfg.table} SET ${sets} WHERE id = @__id`)
        .run({ ...toSqlValues(fields), __id: id });
    }
    if (cfg.afterUpdate) cfg.afterUpdate(existing, getDb().prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(id) as Row, req);
    return getMapped(id);
  };

  const router = Router();

  router.get('/', (req, res) => {
    const user = currentUser(req);
    const q = req.query as Record<string, unknown>;
    const lp = parseList(q, cfg.sortColumns);
    const where: string[] = [];
    const params: unknown[] = [];
    if (!isAdmin(req)) {
      where.push('ownerId = ?');
      params.push(user.id);
    }
    for (const f of cfg.filters ?? []) {
      const v = parseFilterValue(f, q[f.param]);
      if (v === undefined) continue;
      where.push(`${f.column} = ?`);
      params.push(v);
    }
    if (lp.search && cfg.searchColumns.length) {
      const pat = likePattern(lp.search);
      where.push(`(${cfg.searchColumns.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
      cfg.searchColumns.forEach(() => params.push(pat));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const db = getDb();
    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM ${cfg.table} ${whereSql}`)
      .get(...params) as { total: number };
    const sort = lp.sort ?? cfg.defaultSort ?? 'createdAt';
    const order = lp.order === 'asc' ? 'ASC' : 'DESC';
    const rows = db
      .prepare(
        `SELECT * FROM ${cfg.table} ${whereSql} ORDER BY ${sort} COLLATE NOCASE ${order}, id ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, lp.pageSize, (lp.page - 1) * lp.pageSize) as Row[];
    res.json({ data: rows.map(map), total, page: lp.page, pageSize: lp.pageSize });
  });

  router.post('/', (req, res) => {
    const user = currentUser(req);
    const defaults = typeof cfg.defaults === 'function' ? cfg.defaults() : (cfg.defaults ?? {});
    const data = { ...defaults, ...(validate(cfg.createSchema, req.body ?? {}) as Row) };
    checkRefs(req, cfg.refs, data);
    const now = nowIso();
    const fields: Row = { ...toSqlValues({ ...data, ...(cfg.onCreate?.(data) ?? {}) }), ownerId: user.id, createdAt: now };
    if (cfg.hasUpdatedAt) fields.updatedAt = now;
    const keys = Object.keys(fields);
    const info = getDb()
      .prepare(
        `INSERT INTO ${cfg.table} (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`,
      )
      .run(toSqlValues(fields));
    const newId = Number(info.lastInsertRowid);
    cfg.afterCreate?.(getDb().prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(newId) as Row, req);
    res.status(201).json(getMapped(newId));
  });

  router.get('/:id', (req, res) => {
    res.json(map(findOwned(req, parseIdParam(req.params.id))));
  });

  router.patch('/:id', (req, res) => {
    const id = parseIdParam(req.params.id);
    findOwned(req, id); // 404 before validation details leak anything
    const data = validate(cfg.updateSchema, req.body ?? {}) as Row;
    res.json(update(req, id, data));
  });

  router.delete('/:id', (req, res) => {
    const id = parseIdParam(req.params.id);
    findOwned(req, id);
    getDb().prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).run(id);
    res.status(204).end();
  });

  return { router, findOwned, update };
}

function toSqlValues(fields: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return out;
}
