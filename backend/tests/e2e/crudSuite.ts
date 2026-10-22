import { describe, it, expect, beforeAll } from 'vitest';
import {
  api, auth, expectError, expectList, setupUsers,
  VALIDATION, CREATED, DELETED, FORBIDDEN_OR_NOT_FOUND, Session,
} from './helpers';

export interface CrudConfig {
  name: string;
  path: string; // e.g. /api/companies
  /** Field used for search/sort assertions */
  textField: string;
  /** Build a valid payload; `label` must end up in textField. */
  valid: (label: string, ctx: Ctx) => Record<string, unknown>;
  invalid: Record<string, unknown>[];
  patch: Record<string, unknown>;
  invalidPatch: Record<string, unknown>;
  /** Optional dependencies created before the suite (e.g. a company for contacts). */
  prepare?: (ctx: Ctx) => Promise<void>;
  hasUpdatedAt?: boolean;
}

export interface Ctx {
  admin: Session;
  sales1: Session;
  sales2: Session;
  deps: Record<string, any>;
}

export async function create(path: string, s: Session, body: Record<string, unknown>) {
  const r = await (await api()).post(path).set(auth(s)).send(body);
  if (!CREATED.includes(r.status)) {
    throw new Error(`POST ${path} failed ${r.status}: ${JSON.stringify(r.body)}`);
  }
  return r.body;
}

export function crudSuite(cfg: CrudConfig, extra?: (getCtx: () => Ctx) => void) {
  describe(`${cfg.name} CRUD`, () => {
    const ctx = {} as Ctx;
    let created: any;
    const tag = `qa${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(async () => {
      const users = await setupUsers();
      Object.assign(ctx, users, { deps: {} });
      if (cfg.prepare) await cfg.prepare(ctx);
    });

    it('[C-09] requires auth', async () => {
      const r = await (await api()).get(cfg.path);
      expectError(r, 401);
      const p = await (await api()).post(cfg.path).send(cfg.valid('x', ctx));
      expectError(p, 401);
    });

    it('[C-01] creates a valid record owned by the caller', async () => {
      const r = await (await api()).post(cfg.path).set(auth(ctx.sales1)).send(cfg.valid(`${tag} Alpha`, ctx));
      expect(CREATED, JSON.stringify(r.body)).toContain(r.status);
      created = r.body;
      expect(created).toHaveProperty('id');
      expect(String(created.ownerId)).toBe(String(ctx.sales1.user.id));
      expect(typeof created.createdAt).toBe('string');
      expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);
      expect(created[cfg.textField]).toContain(`${tag} Alpha`);
    });

    it('[C-01] ownerId in body cannot assign record to another user (sales)', async () => {
      const body = { ...cfg.valid(`${tag} Owner`, ctx), ownerId: ctx.sales2.user.id };
      const r = await (await api()).post(cfg.path).set(auth(ctx.sales1)).send(body);
      if (CREATED.includes(r.status)) {
        expect(String(r.body.ownerId)).toBe(String(ctx.sales1.user.id));
        await (await api()).delete(`${cfg.path}/${r.body.id}`).set(auth(ctx.sales1));
      } else {
        expectError(r, [...VALIDATION, 403]);
      }
    });

    cfg.invalid.forEach((body, i) => {
      it(`[C-02] rejects invalid payload #${i + 1}`, async () => {
        const r = await (await api()).post(cfg.path).set(auth(ctx.sales1)).send(body);
        expectError(r, VALIDATION);
      });
    });

    it('[C-03] lists records with pagination envelope', async () => {
      const r = await (await api()).get(cfg.path).set(auth(ctx.sales1));
      expectList(r);
      expect(r.body.data.some((x: any) => x.id === created.id)).toBe(true);
    });

    it('[C-04] gets record by id', async () => {
      const r = await (await api()).get(`${cfg.path}/${created.id}`).set(auth(ctx.sales1));
      expect(r.status).toBe(200);
      expect(r.body.id).toBe(created.id);
    });

    it('[C-05] unknown id returns 404', async () => {
      const r = await (await api()).get(`${cfg.path}/999999`).set(auth(ctx.admin));
      expectError(r, 404);
      const p = await (await api()).patch(`${cfg.path}/999999`).set(auth(ctx.admin)).send(cfg.patch);
      expectError(p, [404, ...VALIDATION]);
      const d = await (await api()).delete(`${cfg.path}/999999`).set(auth(ctx.admin));
      expectError(d, 404);
    });

    it('[C-06] partial PATCH updates only given fields', async () => {
      const r = await (await api()).patch(`${cfg.path}/${created.id}`).set(auth(ctx.sales1)).send(cfg.patch);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      for (const [k, v] of Object.entries(cfg.patch)) expect(r.body[k]).toEqual(v);
      expect(r.body[cfg.textField]).toBe(created[cfg.textField]);
      if (cfg.hasUpdatedAt !== false) expect(typeof r.body.updatedAt).toBe('string');
      created = r.body;
    });

    it('[C-07] invalid PATCH returns 400/422', async () => {
      const r = await (await api())
        .patch(`${cfg.path}/${created.id}`)
        .set(auth(ctx.sales1))
        .send(cfg.invalidPatch);
      expectError(r, VALIDATION);
    });

    describe('list features', () => {
      beforeAll(async () => {
        for (const l of ['Charlie', 'Bravo', 'Delta', 'Echo']) {
          await create(cfg.path, ctx.sales1, cfg.valid(`${tag} ${l}`, ctx));
        }
      });

      it('[C-10] pagination page=2&pageSize=2', async () => {
        const all = await (await api()).get(`${cfg.path}?pageSize=100`).set(auth(ctx.sales1));
        expectList(all);
        const total = all.body.total;
        expect(total).toBeGreaterThanOrEqual(5);
        const r = await (await api()).get(`${cfg.path}?page=2&pageSize=2`).set(auth(ctx.sales1));
        expectList(r);
        expect(Number(r.body.page)).toBe(2);
        expect(Number(r.body.pageSize)).toBe(2);
        expect(r.body.data.length).toBe(2);
        expect(r.body.total).toBe(total);
        const p1 = await (await api()).get(`${cfg.path}?page=1&pageSize=2`).set(auth(ctx.sales1));
        const ids1 = p1.body.data.map((x: any) => x.id);
        expect(r.body.data.some((x: any) => ids1.includes(x.id))).toBe(false);
      });

      it('[C-16] page beyond range returns empty data, not error', async () => {
        const r = await (await api()).get(`${cfg.path}?page=999&pageSize=10`).set(auth(ctx.sales1));
        expectList(r);
        expect(r.body.data.length).toBe(0);
      });

      it('[C-16] invalid pagination params do not 500', async () => {
        const r = await (await api()).get(`${cfg.path}?page=-1&pageSize=abc`).set(auth(ctx.sales1));
        expect(r.status).not.toBe(500);
        const big = await (await api()).get(`${cfg.path}?pageSize=100000`).set(auth(ctx.sales1));
        expect(big.status).not.toBe(500);
      });

      it('[C-11] search filters by text', async () => {
        const r = await (await api())
          .get(`${cfg.path}?search=${encodeURIComponent(`${tag} Delta`)}`)
          .set(auth(ctx.sales1));
        expectList(r);
        expect(r.body.data.length).toBeGreaterThanOrEqual(1);
        expect(r.body.data.some((x: any) => String(x[cfg.textField]).includes('Delta'))).toBe(true);
        expect(r.body.data.some((x: any) => String(x[cfg.textField]).includes('Bravo'))).toBe(false);
      });

      it('[C-11] search with no matches returns empty list', async () => {
        const r = await (await api()).get(`${cfg.path}?search=zzzznomatchzzzz`).set(auth(ctx.sales1));
        expectList(r);
        expect(r.body.data.length).toBe(0);
        expect(r.body.total).toBe(0);
      });

      it('[C-12] sort asc/desc by text field', async () => {
        const asc = await (await api())
          .get(`${cfg.path}?search=${tag}&sort=${cfg.textField}&order=asc&pageSize=100`)
          .set(auth(ctx.sales1));
        expectList(asc);
        const a = asc.body.data.map((x: any) => String(x[cfg.textField]));
        expect(a).toEqual([...a].sort((x, y) => x.localeCompare(y)));
        const desc = await (await api())
          .get(`${cfg.path}?search=${tag}&sort=${cfg.textField}&order=desc&pageSize=100`)
          .set(auth(ctx.sales1));
        const d = desc.body.data.map((x: any) => String(x[cfg.textField]));
        expect(d).toEqual([...a].reverse());
      });

      it('[C-12] unknown sort field does not 500 (no SQL injection)', async () => {
        const r = await (await api())
          .get(`${cfg.path}?sort=${encodeURIComponent('id; DROP TABLE users;--')}&order=asc`)
          .set(auth(ctx.sales1));
        expect(r.status).not.toBe(500);
        const me = await (await api()).get('/api/auth/me').set(auth(ctx.sales1));
        expect(me.status).toBe(200);
      });
    });

    describe('permissions', () => {
      it('[C-13] sales2 does not see sales1 records in list', async () => {
        const r = await (await api()).get(`${cfg.path}?pageSize=100`).set(auth(ctx.sales2));
        expectList(r);
        expect(r.body.data.some((x: any) => String(x.ownerId) === String(ctx.sales1.user.id))).toBe(false);
      });

      it('[C-14] sales2 cannot GET/PATCH/DELETE sales1 record', async () => {
        const g = await (await api()).get(`${cfg.path}/${created.id}`).set(auth(ctx.sales2));
        expectError(g, FORBIDDEN_OR_NOT_FOUND);
        const p = await (await api()).patch(`${cfg.path}/${created.id}`).set(auth(ctx.sales2)).send(cfg.patch);
        expectError(p, FORBIDDEN_OR_NOT_FOUND);
        const d = await (await api()).delete(`${cfg.path}/${created.id}`).set(auth(ctx.sales2));
        expectError(d, FORBIDDEN_OR_NOT_FOUND);
        const still = await (await api()).get(`${cfg.path}/${created.id}`).set(auth(ctx.sales1));
        expect(still.status).toBe(200);
      });

      it('[C-15] admin sees and edits everyone records', async () => {
        const l = await (await api()).get(`${cfg.path}?pageSize=100`).set(auth(ctx.admin));
        expectList(l);
        expect(l.body.data.some((x: any) => x.id === created.id)).toBe(true);
        const g = await (await api()).get(`${cfg.path}/${created.id}`).set(auth(ctx.admin));
        expect(g.status).toBe(200);
        const p = await (await api()).patch(`${cfg.path}/${created.id}`).set(auth(ctx.admin)).send(cfg.patch);
        expect(p.status).toBe(200);
      });
    });

    if (extra) extra(() => ctx);

    describe('delete', () => {
      it('[C-08] owner deletes record, then 404', async () => {
        const d = await (await api()).delete(`${cfg.path}/${created.id}`).set(auth(ctx.sales1));
        expect(DELETED, JSON.stringify(d.body)).toContain(d.status);
        const g = await (await api()).get(`${cfg.path}/${created.id}`).set(auth(ctx.sales1));
        expectError(g, 404);
      });

      it('[C-15] admin can delete a sales record', async () => {
        const rec = await create(cfg.path, ctx.sales2, cfg.valid(`${tag} AdminDel`, ctx));
        const d = await (await api()).delete(`${cfg.path}/${rec.id}`).set(auth(ctx.admin));
        expect(DELETED).toContain(d.status);
      });
    });
  });
}
