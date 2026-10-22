import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, register } from './helpers';

let admin: string;
let s1: string;
let s2: string;

beforeAll(async () => {
  admin = (await register('Admin', 'admin@crud.local')).token;
  s1 = (await register('Sales 1', 's1@crud.local')).token;
  s2 = (await register('Sales 2', 's2@crud.local')).token;
});

describe('companies', () => {
  it('full CRUD with ownership', async () => {
    const c = await api()
      .post('/api/companies')
      .set(bearer(s1))
      .send({ name: 'Acme', industry: 'Tools', website: 'https://acme.test' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ name: 'Acme', industry: 'Tools' });
    expect(typeof c.body.createdAt).toBe('string');
    const id = c.body.id;

    expect((await api().get(`/api/companies/${id}`).set(bearer(s1))).status).toBe(200);
    // other sales cannot see/edit/delete
    expect((await api().get(`/api/companies/${id}`).set(bearer(s2))).status).toBe(404);
    expect((await api().patch(`/api/companies/${id}`).set(bearer(s2)).send({ name: 'X' })).status).toBe(404);
    expect((await api().delete(`/api/companies/${id}`).set(bearer(s2))).status).toBe(404);
    const l2 = await api().get('/api/companies').set(bearer(s2));
    expect(l2.body.data.find((x: { id: number }) => x.id === id)).toBeUndefined();
    // admin can
    expect((await api().get(`/api/companies/${id}`).set(bearer(admin))).status).toBe(200);

    const p = await api().patch(`/api/companies/${id}`).set(bearer(s1)).send({ phone: '123' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ name: 'Acme', phone: '123' });

    expect((await api().patch(`/api/companies/${id}`).set(bearer(s1)).send({ name: '' })).status).toBe(400);
    expect((await api().patch(`/api/companies/${id}`).set(bearer(s1)).send({ ownerId: 1 })).status).toBe(400);
    expect(
      (await api().post('/api/companies').set(bearer(s1)).send({ name: 'Bad', website: 'javascript:alert(1)' })).status,
    ).toBe(400);

    expect((await api().delete(`/api/companies/${id}`).set(bearer(s1))).status).toBe(204);
    expect((await api().get(`/api/companies/${id}`).set(bearer(s1))).status).toBe(404);
  });

  it('pagination, search and sort', async () => {
    for (const name of ['Delta', 'alpha', 'Charlie', 'bravo', 'Echo 100%']) {
      await api().post('/api/companies').set(bearer(s2)).send({ name });
    }
    const p = await api().get('/api/companies?page=2&pageSize=2&sort=name&order=asc').set(bearer(s2));
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(p.body.data.map((c: { name: string }) => c.name)).toEqual(['Charlie', 'Delta']);

    const s = await api().get('/api/companies?search=ALPH').set(bearer(s2));
    expect(s.body.total).toBe(1);
    const pct = await api().get('/api/companies?search=%25').set(bearer(s2));
    expect(pct.body.data.map((c: { name: string }) => c.name)).toEqual(['Echo 100%']);

    const big = await api().get('/api/companies?pageSize=100000&page=99').set(bearer(s2));
    expect(big.status).toBe(200);
    expect(big.body.pageSize).toBe(100);
    expect(big.body.data).toEqual([]);

    expect((await api().get('/api/companies?sort=ownerId;DROP').set(bearer(s2))).status).toBe(400);
    expect((await api().get('/api/companies?order=sideways').set(bearer(s2))).status).toBe(400);
  });
});

describe('contacts, deals, activities, dashboard', () => {
  it('end-to-end flow with filters and references', async () => {
    const co = (await api().post('/api/companies').set(bearer(s1)).send({ name: 'Initech' })).body;
    const foreignCo = (await api().post('/api/companies').set(bearer(s2)).send({ name: 'Other' })).body;

    const ct = await api()
      .post('/api/contacts')
      .set(bearer(s1))
      .send({ firstName: 'Peter', lastName: 'Gibbons', email: 'peter@initech.test', companyId: co.id });
    expect(ct.status).toBe(201);
    await api().post('/api/contacts').set(bearer(s1)).send({ firstName: 'No', lastName: 'Company' });
    const byCo = await api().get(`/api/contacts?companyId=${co.id}`).set(bearer(s1));
    expect(byCo.body.total).toBe(1);

    // reference to non-existent or foreign company
    expect(
      (await api().post('/api/contacts').set(bearer(s1)).send({ firstName: 'a', lastName: 'b', companyId: 99999 })).status,
    ).toBe(422);
    expect(
      (await api().post('/api/contacts').set(bearer(s1)).send({ firstName: 'a', lastName: 'b', companyId: foreignCo.id }))
        .status,
    ).toBe(422);

    const d = await api()
      .post('/api/deals')
      .set(bearer(s1))
      .send({ title: 'TPS', value: 1000, contactId: ct.body.id, companyId: co.id });
    expect(d.status).toBe(201);
    expect(d.body).toMatchObject({ currency: 'USD', stage: 'lead', value: 1000 });
    expect((await api().post('/api/deals').set(bearer(s1)).send({ title: 'x', value: -1 })).status).toBe(400);
    expect((await api().post('/api/deals').set(bearer(s1)).send({ title: 'x', value: 'abc' })).status).toBe(400);
    expect((await api().post('/api/deals').set(bearer(s1)).send({ title: 'x', stage: 'bogus' })).status).toBe(400);
    const won = await api().post('/api/deals').set(bearer(s1)).send({ title: 'Won', value: 500, stage: 'won' });
    expect(won.status).toBe(201);

    const st = await api().patch(`/api/deals/${d.body.id}/stage`).set(bearer(s1)).send({ stage: 'proposal' });
    expect(st.status).toBe(200);
    expect(st.body.stage).toBe('proposal');
    expect((await api().patch(`/api/deals/${d.body.id}/stage`).set(bearer(s1)).send({ stage: 'zzz' })).status).toBe(400);
    expect((await api().patch(`/api/deals/99999/stage`).set(bearer(s1)).send({ stage: 'won' })).status).toBe(404);
    expect((await api().patch(`/api/deals/${d.body.id}/stage`).set(bearer(s2)).send({ stage: 'won' })).status).toBe(404);

    const f = await api().get('/api/deals?stage=proposal').set(bearer(s1));
    expect(f.body.total).toBe(1);
    expect((await api().get(`/api/deals?companyId=${co.id}`).set(bearer(s1))).body.total).toBe(1);
    expect((await api().get(`/api/deals?contactId=${ct.body.id}`).set(bearer(s1))).body.total).toBe(1);
    expect((await api().get('/api/deals?sort=value&order=desc').set(bearer(s1))).body.data[0].value).toBe(1000);

    const future = new Date(Date.now() + 86400000).toISOString();
    const a = await api()
      .post('/api/activities')
      .set(bearer(s1))
      .send({ type: 'call', subject: 'Call Peter', dueDate: future, contactId: ct.body.id, dealId: d.body.id });
    expect(a.status).toBe(201);
    expect(a.body.completed).toBe(false);
    expect((await api().post('/api/activities').set(bearer(s1)).send({ type: 'fax', subject: 'x' })).status).toBe(400);
    await api().post('/api/activities').set(bearer(s1)).send({ type: 'note', subject: 'Done thing', completed: true });

    expect((await api().get('/api/activities?completed=true').set(bearer(s1))).body.total).toBe(1);
    expect((await api().get('/api/activities?completed=false').set(bearer(s1))).body.total).toBe(1);
    expect((await api().get(`/api/activities?dealId=${d.body.id}`).set(bearer(s1))).body.total).toBe(1);
    expect((await api().get(`/api/activities?contactId=${ct.body.id}`).set(bearer(s1))).body.total).toBe(1);

    // dashboard (s1 view) before completing
    const dash = await api().get('/api/dashboard/stats').set(bearer(s1));
    expect(dash.status).toBe(200);
    expect(dash.body.totals).toEqual({ companies: 1, contacts: 2, deals: 2, openDealsValue: 1000, wonDealsValue: 500 });
    expect(dash.body.dealsByStage).toHaveLength(6);
    expect(dash.body.dealsByStage.find((x: { stage: string }) => x.stage === 'proposal')).toEqual({
      stage: 'proposal',
      count: 1,
      value: 1000,
    });
    expect(dash.body.upcomingActivities.map((x: { id: number }) => x.id)).toEqual([a.body.id]);

    const done = await api().patch(`/api/activities/${a.body.id}`).set(bearer(s1)).send({ completed: true });
    expect(done.status).toBe(200);
    expect(done.body.completed).toBe(true);

    // s2 sees only own data; admin sees everything
    const d2 = await api().get('/api/dashboard/stats').set(bearer(s2));
    expect(d2.body.totals.deals).toBe(0);
    const dAdmin = await api().get('/api/dashboard/stats').set(bearer(admin));
    expect(dAdmin.body.totals.deals).toBeGreaterThanOrEqual(2);
    expect((await api().get('/api/dashboard/stats')).status).toBe(401);

    // deleting company nulls references
    expect((await api().delete(`/api/companies/${co.id}`).set(bearer(s1))).status).toBe(204);
    const ct2 = await api().get(`/api/contacts/${ct.body.id}`).set(bearer(s1));
    expect(ct2.body.companyId).toBeNull();
  });

  it('requires auth on entity routes', async () => {
    for (const p of ['/api/companies', '/api/contacts', '/api/deals', '/api/activities']) {
      const r = await api().get(p);
      expect(r.status).toBe(401);
      expect(typeof r.body.error.code).toBe('string');
    }
  });
});
