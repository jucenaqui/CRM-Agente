import { describe, it, expect } from 'vitest';
import { crudSuite, create } from './crudSuite';
import { api, auth, expectList, VALIDATION, CREATED } from './helpers';

crudSuite(
  {
    name: 'Contacts',
    path: '/api/contacts',
    textField: 'firstName',
    valid: (label) => ({
      firstName: label,
      lastName: 'Tester',
      email: `c${Math.random().toString(36).slice(2, 8)}@qa.test`,
      phone: '600111222',
      position: 'CTO',
    }),
    invalid: [{}, { firstName: '', lastName: 'X' }, { firstName: 'A', lastName: 'B', email: 'not-an-email' }],
    patch: { position: 'CEO' },
    invalidPatch: { email: 'bad-email' },
  },
  (getCtx) => {
    describe('contacts specific', () => {
      it('[CT-01] filter by companyId', async () => {
        const ctx = getCtx();
        const company = await create('/api/companies', ctx.sales1, { name: 'Filter Co' });
        const other = await create('/api/companies', ctx.sales1, { name: 'Other Co' });
        const inCo = await create('/api/contacts', ctx.sales1, {
          firstName: 'InCo', lastName: 'One', companyId: company.id,
        });
        await create('/api/contacts', ctx.sales1, { firstName: 'OutCo', lastName: 'Two', companyId: other.id });
        expect(inCo.companyId).toEqual(company.id);
        const r = await (await api()).get(`/api/contacts?companyId=${company.id}`).set(auth(ctx.sales1));
        expectList(r);
        expect(r.body.data.length).toBe(1);
        expect(r.body.data[0].id).toBe(inCo.id);
      });

      it('[CT-02] contact with non-existent companyId is rejected (not 500)', async () => {
        const ctx = getCtx();
        const r = await (await api())
          .post('/api/contacts')
          .set(auth(ctx.sales1))
          .send({ firstName: 'Ghost', lastName: 'Co', companyId: 999999 });
        expect(r.status).not.toBe(500);
        expect(CREATED).not.toContain(r.status);
        expect([...VALIDATION, 404]).toContain(r.status);
      });

      it('[CT-03] sales cannot link contact to another user company', async () => {
        const ctx = getCtx();
        const foreign = await create('/api/companies', ctx.sales2, { name: 'Foreign Co' });
        const r = await (await api())
          .post('/api/contacts')
          .set(auth(ctx.sales1))
          .send({ firstName: 'Cross', lastName: 'Link', companyId: foreign.id });
        expect(r.status).not.toBe(500);
        expect(CREATED).not.toContain(r.status);
      });
    });
  },
);
