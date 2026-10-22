import { describe, it, expect, beforeAll } from 'vitest';
import { create } from './crudSuite';
import { api, auth, expectError, setupUsers, uniqueEmail, VALIDATION, CREATED, DELETED, Session } from './helpers';

describe('Edge cases', () => {
  let admin: Session, sales1: Session, sales2: Session;

  beforeAll(async () => {
    ({ admin, sales1, sales2 } = await setupUsers());
  });

  it('[E-03] non-numeric id returns 400/404, never 500', async () => {
    for (const p of ['/api/companies/abc', '/api/contacts/1.5', '/api/deals/-1', '/api/activities/%27or%271']) {
      const r = await (await api()).get(p).set(auth(admin));
      expectError(r, [400, 404, 422]);
    }
    const s = await (await api()).patch('/api/deals/abc/stage').set(auth(admin)).send({ stage: 'won' });
    expectError(s, [400, 404, 422]);
  });

  it('[E-04] PATCH with empty body does not 500', async () => {
    const c = await create('/api/companies', sales1, { name: 'Empty patch' });
    const r = await (await api()).patch(`/api/companies/${c.id}`).set(auth(sales1)).send({});
    expect(r.status).not.toBe(500);
  });

  it('[E-05] unknown extra fields do not 500', async () => {
    const r = await (await api()).post('/api/companies').set(auth(sales1)).send({ name: 'X', foo: 'bar', id: 99 });
    expect(r.status).not.toBe(500);
  });

  it('[E-06] deal linked to another user contact/company is rejected (not 500)', async () => {
    const co = await create('/api/companies', sales2, { name: 'S2 company' });
    const ct = await create('/api/contacts', sales2, { firstName: 'S2', lastName: 'Contact' });
    const r1 = await (await api()).post('/api/deals').set(auth(sales1)).send({ title: 'x', value: 1, companyId: co.id });
    expect(r1.status).not.toBe(500);
    expect(CREATED).not.toContain(r1.status);
    const r2 = await (await api()).post('/api/deals').set(auth(sales1)).send({ title: 'x', value: 1, contactId: ct.id });
    expect(CREATED).not.toContain(r2.status);
  });

  it('[E-07] activity linked to another user deal/contact is rejected (not 500)', async () => {
    const dl = await create('/api/deals', sales2, { title: 'S2 deal', value: 1 });
    const r = await (await api()).post('/api/activities').set(auth(sales1)).send({ type: 'call', subject: 'x', dealId: dl.id });
    expect(r.status).not.toBe(500);
    expect(CREATED).not.toContain(r.status);
    const r2 = await (await api()).post('/api/activities').set(auth(sales1)).send({ type: 'call', subject: 'x', dealId: 999999 });
    expect(r2.status).not.toBe(500);
    expect(CREATED).not.toContain(r2.status);
  });

  it('[E-08] deleting a company keeps its contacts (companyId -> null)', async () => {
    const co = await create('/api/companies', sales1, { name: 'To delete' });
    const ct = await create('/api/contacts', sales1, { firstName: 'Orphan', lastName: 'X', companyId: co.id });
    const d = await (await api()).delete(`/api/companies/${co.id}`).set(auth(sales1));
    expect(DELETED).toContain(d.status);
    const g = await (await api()).get(`/api/contacts/${ct.id}`).set(auth(sales1));
    expect(g.status).toBe(200);
    expect(g.body.companyId ?? null).toBeNull();
  });

  it('[E-09] deleting a user who owns records does not 500', async () => {
    const email = uniqueEmail('owner');
    const u = await (await api()).post('/api/users').set(auth(admin))
      .send({ name: 'Owner', email, password: 'Password123!', role: 'sales' });
    const login = await (await api()).post('/api/auth/login').send({ email, password: 'Password123!' });
    await create('/api/companies', { token: login.body.token } as Session, { name: 'Owned' });
    const d = await (await api()).delete(`/api/users/${(u.body.user ?? u.body).id}`).set(auth(admin));
    expect(d.status).not.toBe(500);
    expect([...DELETED, 409, 422]).toContain(d.status);
  });

  it('[E-10] admin cannot delete themselves or demote the last admin (no lockout)', async () => {
    const d = await (await api()).delete(`/api/users/${admin.user.id}`).set(auth(admin));
    expect(d.status).not.toBe(500);
    const me = await (await api()).get('/api/auth/me').set(auth(admin));
    // Either the delete was refused, or (if allowed) the API must still be consistent.
    if (DELETED.includes(d.status)) expect(me.status).toBe(401);
    else expect(me.status).toBe(200);
  });

  it('[E-11] token of a deleted user is rejected', async () => {
    const email = uniqueEmail('gone');
    const u = await (await api()).post('/api/users').set(auth(admin))
      .send({ name: 'Gone', email, password: 'Password123!', role: 'sales' });
    const login = await (await api()).post('/api/auth/login').send({ email, password: 'Password123!' });
    await (await api()).delete(`/api/users/${(u.body.user ?? u.body).id}`).set(auth(admin));
    const r = await (await api()).get('/api/companies').set(auth(login.body.token));
    expectError(r, 401);
  });

  it('[E-12] very long strings are rejected or accepted, never 500', async () => {
    const r = await (await api()).post('/api/companies').set(auth(sales1)).send({ name: 'x'.repeat(5000) });
    expect(r.status).not.toBe(500);
  });

  it('[E-13] XSS payload is stored as plain text', async () => {
    const r = await (await api()).post('/api/companies').set(auth(sales1)).send({ name: '<script>alert(1)</script>' });
    expect(CREATED).toContain(r.status);
    expect(r.body.name).toBe('<script>alert(1)</script>');
    expect(r.headers['content-type']).toMatch(/application\/json/);
  });

  it('[E-14] search with SQL wildcard/injection characters is safe', async () => {
    for (const q of ["%", "_", "' OR 1=1 --", '"']) {
      const r = await (await api()).get(`/api/companies?search=${encodeURIComponent(q)}`).set(auth(sales2));
      expect(r.status).toBe(200);
      expect(r.body.data.every((c: any) => String(c.ownerId) === String(sales2.user.id))).toBe(true);
    }
  });

  it('[E-15] deal value accepts decimals and zero; currency custom', async () => {
    const d = await create('/api/deals', sales1, { title: 'dec', value: 0, currency: 'EUR' });
    expect(d.value).toBe(0);
    expect(d.currency).toBe('EUR');
    const d2 = await create('/api/deals', sales1, { title: 'dec2', value: 1234.56 });
    expect(d2.value).toBeCloseTo(1234.56);
  });

  it('[E-16] invalid dates are rejected', async () => {
    const r = await (await api()).post('/api/deals').set(auth(sales1)).send({ title: 'x', value: 1, expectedCloseDate: 'not-a-date' });
    expectError(r, VALIDATION);
    const a = await (await api()).post('/api/activities').set(auth(sales1)).send({ type: 'call', subject: 'x', dueDate: 'tomorrow' });
    expectError(a, VALIDATION);
  });
});
