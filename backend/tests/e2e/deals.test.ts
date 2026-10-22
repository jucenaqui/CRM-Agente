import { describe, it, expect } from 'vitest';
import { crudSuite, create } from './crudSuite';
import { api, auth, expectError, expectList, VALIDATION, FORBIDDEN_OR_NOT_FOUND } from './helpers';

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

crudSuite(
  {
    name: 'Deals',
    path: '/api/deals',
    textField: 'title',
    valid: (label) => ({ title: label, value: 1000, stage: 'lead', expectedCloseDate: '2026-12-31' }),
    invalid: [
      {},
      { title: 'X', value: 'abc' },
      { title: 'X', value: 10, stage: 'bogus' },
      { title: 'X', value: -5 },
    ],
    patch: { value: 2500 },
    invalidPatch: { stage: 'invalid-stage' },
  },
  (getCtx) => {
    describe('deals specific', () => {
      it('[D-01] currency defaults to USD and stage defaults to lead', async () => {
        const ctx = getCtx();
        const d = await create('/api/deals', ctx.sales1, { title: 'Default deal', value: 10 });
        expect(d.currency).toBe('USD');
        expect(d.stage).toBe('lead');
        expect(typeof d.value).toBe('number');
      });

      it('[D-02] rejects invalid stage on create', async () => {
        const ctx = getCtx();
        const r = await (await api()).post('/api/deals').set(auth(ctx.sales1)).send({ title: 'x', value: 1, stage: 'closed' });
        expectError(r, VALIDATION);
      });

      it('[D-03] filters by stage, companyId and contactId', async () => {
        const ctx = getCtx();
        const co = await create('/api/companies', ctx.sales1, { name: 'Deal Co' });
        const ct = await create('/api/contacts', ctx.sales1, { firstName: 'Deal', lastName: 'Contact' });
        const a = await create('/api/deals', ctx.sales1, { title: 'F-A', value: 1, stage: 'proposal', companyId: co.id });
        const b = await create('/api/deals', ctx.sales1, { title: 'F-B', value: 1, stage: 'negotiation', contactId: ct.id });

        const s = await (await api()).get('/api/deals?stage=proposal&pageSize=100').set(auth(ctx.sales1));
        expectList(s);
        expect(s.body.data.length).toBeGreaterThanOrEqual(1);
        expect(s.body.data.every((d: any) => d.stage === 'proposal')).toBe(true);
        expect(s.body.data.some((d: any) => d.id === a.id)).toBe(true);

        const c = await (await api()).get(`/api/deals?companyId=${co.id}`).set(auth(ctx.sales1));
        expectList(c);
        expect(c.body.data.map((d: any) => d.id)).toEqual([a.id]);

        const k = await (await api()).get(`/api/deals?contactId=${ct.id}`).set(auth(ctx.sales1));
        expectList(k);
        expect(k.body.data.map((d: any) => d.id)).toEqual([b.id]);
      });

      it('[D-04] PATCH /deals/:id/stage moves through all stages', async () => {
        const ctx = getCtx();
        const d = await create('/api/deals', ctx.sales1, { title: 'Kanban', value: 50 });
        for (const stage of STAGES) {
          const r = await (await api()).patch(`/api/deals/${d.id}/stage`).set(auth(ctx.sales1)).send({ stage });
          expect(r.status, JSON.stringify(r.body)).toBe(200);
          expect(r.body.stage).toBe(stage);
        }
        const g = await (await api()).get(`/api/deals/${d.id}`).set(auth(ctx.sales1));
        expect(g.body.stage).toBe('lost');
      });

      it('[D-05] PATCH stage with invalid value returns 400/422', async () => {
        const ctx = getCtx();
        const d = await create('/api/deals', ctx.sales1, { title: 'Bad stage', value: 5 });
        const r = await (await api()).patch(`/api/deals/${d.id}/stage`).set(auth(ctx.sales1)).send({ stage: 'nope' });
        expectError(r, VALIDATION);
        const e = await (await api()).patch(`/api/deals/${d.id}/stage`).set(auth(ctx.sales1)).send({});
        expectError(e, VALIDATION);
      });

      it('[D-06] PATCH stage on unknown deal returns 404', async () => {
        const ctx = getCtx();
        const r = await (await api()).patch('/api/deals/999999/stage').set(auth(ctx.sales1)).send({ stage: 'won' });
        expectError(r, 404);
      });

      it('[D-07] sales cannot change stage of another user deal', async () => {
        const ctx = getCtx();
        const d = await create('/api/deals', ctx.sales1, { title: 'Mine', value: 5 });
        const r = await (await api()).patch(`/api/deals/${d.id}/stage`).set(auth(ctx.sales2)).send({ stage: 'won' });
        expectError(r, FORBIDDEN_OR_NOT_FOUND);
        const g = await (await api()).get(`/api/deals/${d.id}`).set(auth(ctx.sales1));
        expect(g.body.stage).toBe('lead');
      });

      it('[D-07] PATCH stage requires auth', async () => {
        const r = await (await api()).patch('/api/deals/1/stage').send({ stage: 'won' });
        expectError(r, 401);
      });
    });
  },
);
