import { describe, it, expect } from 'vitest';
import { crudSuite, create } from './crudSuite';
import { api, auth, expectError, expectList, VALIDATION } from './helpers';

crudSuite(
  {
    name: 'Activities',
    path: '/api/activities',
    textField: 'subject',
    hasUpdatedAt: false,
    valid: (label) => ({ type: 'call', subject: label, description: 'desc', dueDate: '2030-01-01T10:00:00.000Z' }),
    invalid: [{}, { type: 'party', subject: 'x' }, { type: 'call', subject: '' }],
    patch: { completed: true },
    invalidPatch: { type: 'invalid' },
  },
  (getCtx) => {
    describe('activities specific', () => {
      it('[AC-01] rejects invalid type', async () => {
        const ctx = getCtx();
        const r = await (await api()).post('/api/activities').set(auth(ctx.sales1)).send({ type: 'lunch', subject: 'x' });
        expectError(r, VALIDATION);
      });

      it('[AC-02] completed defaults to false and is boolean', async () => {
        const ctx = getCtx();
        const a = await create('/api/activities', ctx.sales1, { type: 'note', subject: 'Default completed' });
        expect(a.completed).toBe(false);
      });

      it('[AC-03] filters by contactId, dealId and completed', async () => {
        const ctx = getCtx();
        const ct = await create('/api/contacts', ctx.sales1, { firstName: 'Act', lastName: 'Contact' });
        const dl = await create('/api/deals', ctx.sales1, { title: 'Act deal', value: 1 });
        const a1 = await create('/api/activities', ctx.sales1, { type: 'email', subject: 'ByContact', contactId: ct.id });
        const a2 = await create('/api/activities', ctx.sales1, { type: 'meeting', subject: 'ByDeal', dealId: dl.id });

        const c = await (await api()).get(`/api/activities?contactId=${ct.id}`).set(auth(ctx.sales1));
        expectList(c);
        expect(c.body.data.map((a: any) => a.id)).toEqual([a1.id]);

        const d = await (await api()).get(`/api/activities?dealId=${dl.id}`).set(auth(ctx.sales1));
        expectList(d);
        expect(d.body.data.map((a: any) => a.id)).toEqual([a2.id]);

        await (await api()).patch(`/api/activities/${a1.id}`).set(auth(ctx.sales1)).send({ completed: true });
        const done = await (await api()).get('/api/activities?completed=true&pageSize=100').set(auth(ctx.sales1));
        expectList(done);
        expect(done.body.data.length).toBeGreaterThanOrEqual(1);
        expect(done.body.data.every((a: any) => a.completed === true)).toBe(true);
        expect(done.body.data.some((a: any) => a.id === a1.id)).toBe(true);

        const pending = await (await api()).get('/api/activities?completed=false&pageSize=100').set(auth(ctx.sales1));
        expectList(pending);
        expect(pending.body.data.every((a: any) => a.completed === false)).toBe(true);
        expect(pending.body.data.some((a: any) => a.id === a2.id)).toBe(true);
      });

      it('[AC-04] PATCH completed toggles back and forth', async () => {
        const ctx = getCtx();
        const a = await create('/api/activities', ctx.sales1, { type: 'task', subject: 'Toggle' });
        const on = await (await api()).patch(`/api/activities/${a.id}`).set(auth(ctx.sales1)).send({ completed: true });
        expect(on.status).toBe(200);
        expect(on.body.completed).toBe(true);
        const off = await (await api()).patch(`/api/activities/${a.id}`).set(auth(ctx.sales1)).send({ completed: false });
        expect(off.body.completed).toBe(false);
      });
    });
  },
);
