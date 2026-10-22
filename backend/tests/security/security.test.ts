import { beforeAll, describe, expect, it } from 'vitest';
import { api, auth, containsPasswordHash, register } from './helpers';

type S = Awaited<ReturnType<typeof register>>;
let admin: S;
let s1: S;
let s2: S;
const ids: Record<string, string | number> = {};

const payloads = (): Record<string, Record<string, unknown>> => ({
  companies: { name: 'Sec Corp', industry: 'IT', website: 'https://sec.example', phone: '123', address: 'x' },
  contacts: { firstName: 'Ana', lastName: 'Sec', email: 'ana@sec.example', phone: '1', position: 'CTO' },
  deals: { title: 'Sec deal', value: 1000, currency: 'USD', stage: 'lead' },
  activities: { type: 'call', subject: 'Sec call', description: 'd', completed: false },
});
const patches: Record<string, Record<string, unknown>> = {
  companies: { name: 'HACKED' },
  contacts: { firstName: 'HACKED' },
  deals: { title: 'HACKED' },
  activities: { subject: 'HACKED' },
};
const resources = ['companies', 'contacts', 'deals', 'activities'] as const;
const NOT_ALLOWED = [403, 404];

beforeAll(async () => {
  admin = await register('Sec Admin');
  s1 = await register('Sec Sales One');
  s2 = await register('Sec Sales Two');
  const a = await api();
  for (const r of resources) {
    const res = await a.post(`/api/${r}`).set(auth(s1)).send(payloads()[r]);
    expect([200, 201], `${r}: ${JSON.stringify(res.body)}`).toContain(res.status);
    ids[r] = res.body.id ?? res.body.data?.id;
  }
});

describe('roles', () => {
  it('first user is admin, the rest are sales', () => {
    expect(admin.user.role).toBe('admin');
    expect(s1.user.role).toBe('sales');
  });
  it('register ignores a client-supplied role', async () => {
    const res = await (await api())
      .post('/api/auth/register')
      .send({ name: 'Evil', email: `evil.${Date.now()}@sec.test`, password: 'Password123!', role: 'admin' });
    if (res.status === 200 || res.status === 201) expect(res.body.user.role).toBe('sales');
    else expect([400, 422]).toContain(res.status);
  });
  it('sales cannot list or create users', async () => {
    const a = await api();
    expect([403]).toContain((await a.get('/api/users').set(auth(s1))).status);
    const c = await a
      .post('/api/users')
      .set(auth(s1))
      .send({ name: 'x', email: `x.${Date.now()}@sec.test`, password: 'Password123!', role: 'admin' });
    expect(c.status).toBe(403);
    const p = await a.patch(`/api/users/${s1.user.id}`).set(auth(s1)).send({ role: 'admin' });
    expect(p.status).toBe(403);
  });
});

describe('authentication', () => {
  const protectedRoutes = [
    '/api/auth/me',
    '/api/users',
    '/api/companies',
    '/api/contacts',
    '/api/deals',
    '/api/activities',
    '/api/dashboard/stats',
  ];
  it.each(protectedRoutes)('GET %s without token -> 401', async (path) => {
    const res = await (await api()).get(path);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBeTypeOf('string');
  });
  it('rejects malformed / forged / alg=none tokens', async () => {
    const a = await api();
    const none =
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') +
      '.' +
      Buffer.from(JSON.stringify({ sub: admin.user.id, id: admin.user.id, role: 'admin' })).toString('base64url') +
      '.';
    for (const t of ['garbage', none, s1.token.slice(0, -4) + 'abcd']) {
      const res = await a.get('/api/companies').set({ Authorization: `Bearer ${t}` });
      expect(res.status).toBe(401);
    }
  });
  it('login does not reveal whether the email exists', async () => {
    const a = await api();
    const wrongPass = await a.post('/api/auth/login').send({ email: s1.email, password: 'WrongPass123!' });
    const noUser = await a.post('/api/auth/login').send({ email: `nouser.${Date.now()}@sec.test`, password: 'WrongPass123!' });
    expect(wrongPass.status).toBe(401);
    expect(noUser.status).toBe(wrongPass.status);
    expect(noUser.body.error.code).toBe(wrongPass.body.error.code);
    expect(noUser.body.error.message).toBe(wrongPass.body.error.message);
  });
});

describe('IDOR between sales users', () => {
  it.each(resources)('sales2 cannot read sales1 %s', async (r) => {
    const res = await (await api()).get(`/api/${r}/${ids[r]}`).set(auth(s2));
    expect(NOT_ALLOWED).toContain(res.status);
  });
  it.each(resources)('sales2 cannot see sales1 %s in lists', async (r) => {
    const res = await (await api()).get(`/api/${r}?pageSize=100`).set(auth(s2));
    expect(res.status).toBe(200);
    expect(res.body.data.map((x: any) => x.id)).not.toContain(ids[r]);
  });
  it.each(resources)('sales2 cannot edit sales1 %s', async (r) => {
    const a = await api();
    const res = await a.patch(`/api/${r}/${ids[r]}`).set(auth(s2)).send(patches[r]);
    expect(NOT_ALLOWED).toContain(res.status);
    const check = await a.get(`/api/${r}/${ids[r]}`).set(auth(s1));
    expect(JSON.stringify(check.body)).not.toContain('HACKED');
  });
  it('sales2 cannot move sales1 deal stage', async () => {
    const a = await api();
    const res = await a.patch(`/api/deals/${ids.deals}/stage`).set(auth(s2)).send({ stage: 'won' });
    expect(NOT_ALLOWED).toContain(res.status);
    const check = await a.get(`/api/deals/${ids.deals}`).set(auth(s1));
    expect(check.body.stage ?? check.body.data?.stage).toBe('lead');
  });
  it('sales2 cannot link own records to sales1 company/contact/deal', async () => {
    const a = await api();
    const c = await a.post('/api/contacts').set(auth(s2)).send({ ...payloads().contacts, companyId: ids.companies });
    expect([400, 403, 404, 422]).toContain(c.status);
    const d = await a.post('/api/deals').set(auth(s2)).send({ ...payloads().deals, contactId: ids.contacts });
    expect([400, 403, 404, 422]).toContain(d.status);
    const act = await a.post('/api/activities').set(auth(s2)).send({ ...payloads().activities, dealId: ids.deals });
    expect([400, 403, 404, 422]).toContain(act.status);
  });
  it('sales2 cannot reassign ownership via ownerId', async () => {
    const a = await api();
    const res = await a.post('/api/companies').set(auth(s2)).send({ ...payloads().companies, ownerId: s1.user.id });
    if (res.status === 200 || res.status === 201) {
      expect(res.body.ownerId ?? res.body.data?.ownerId).toBe(s2.user.id);
    } else {
      expect([400, 422]).toContain(res.status);
    }
  });
  it('dashboard of sales2 does not include sales1 data', async () => {
    const res = await (await api()).get('/api/dashboard/stats').set(auth(s2));
    expect(res.status).toBe(200);
    expect(res.body.totals.deals).toBe(0);
    expect(res.body.totals.openDealsValue).toBe(0);
  });
  it.each(resources)('sales2 cannot delete sales1 %s', async (r) => {
    const a = await api();
    const res = await a.delete(`/api/${r}/${ids[r]}`).set(auth(s2));
    expect(NOT_ALLOWED).toContain(res.status);
    const check = await a.get(`/api/${r}/${ids[r]}`).set(auth(s1));
    expect(check.status).toBe(200);
  });
  it('admin can read sales1 records', async () => {
    const res = await (await api()).get(`/api/companies/${ids.companies}`).set(auth(admin));
    expect(res.status).toBe(200);
  });
});

describe('injection', () => {
  const evilSorts = [
    'name; DROP TABLE users',
    "name' --",
    '(SELECT passwordHash FROM users)',
    'passwordHash',
    '1,(select 1)',
  ];
  it.each(resources)('rejects injected sort on %s', async (r) => {
    const a = await api();
    for (const sort of evilSorts) {
      const res = await a.get(`/api/${r}`).query({ sort }).set(auth(s1));
      expect([400, 422], `${r} sort=${sort} -> ${res.status}`).toContain(res.status);
    }
  });
  it('rejects injected order', async () => {
    const res = await (await api()).get('/api/companies').query({ sort: 'name', order: 'asc; DROP TABLE users' }).set(auth(s1));
    expect([400, 422]).toContain(res.status);
  });
  it('search with SQL metacharacters is treated as data', async () => {
    const a = await api();
    const res = await a.get('/api/companies').query({ search: "' OR 1=1 --" }).set(auth(s2));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
    const users = await a.get('/api/users').set(auth(admin));
    expect(users.status).toBe(200);
  });
  it('rejects oversized bodies (>100kb)', async () => {
    const res = await (await api())
      .post('/api/companies')
      .set(auth(s1))
      .send({ ...payloads().companies, address: 'a'.repeat(120 * 1024) });
    expect([400, 413, 422]).toContain(res.status);
  });
  it('malformed JSON returns a JSON error without stack', async () => {
    const res = await (await api())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect([400, 422]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js):\d+/);
  });
});

describe('information disclosure', () => {
  it('passwordHash never appears in auth/users responses', async () => {
    const a = await api();
    const login = await a.post('/api/auth/login').send({ email: s1.email, password: s1.password });
    expect(login.status).toBe(200);
    const responses = [
      admin.user,
      s1.user,
      login.body,
      (await a.get('/api/auth/me').set(auth(s1))).body,
      (await a.get('/api/users?pageSize=100').set(auth(admin))).body,
      (await a.patch(`/api/users/${s2.user.id}`).set(auth(admin)).send({ name: 'Sec Sales 2b' })).body,
      (await a
        .post('/api/users')
        .set(auth(admin))
        .send({ name: 'Created', email: `created.${Date.now()}@sec.test`, password: 'Password123!', role: 'sales' })).body,
    ];
    for (const body of responses) expect(containsPasswordHash(body), JSON.stringify(body)).toBe(false);
  });
  it('hides x-powered-by and sets helmet headers', async () => {
    const res = await (await api()).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
  it('CORS does not allow arbitrary origins', async () => {
    const a = await api();
    const evil = await a.get('/api/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const good = await a.get('/api/health').set('Origin', 'http://localhost:5173');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
