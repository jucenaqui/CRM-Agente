import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, register } from './helpers';

describe('health & errors', () => {
  it('GET /api/health works without auth', async () => {
    const r = await api().get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('unknown route returns 404 in contract format', async () => {
    const r = await api().get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });

  it('malformed JSON returns 400', async () => {
    const r = await api()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_JSON');
  });
});

describe('auth', () => {
  let adminToken: string;

  beforeAll(async () => {
    const a = await register('Admin', 'admin@test.local');
    adminToken = a.token;
    expect(a.user.role).toBe('admin');
  });

  it('second user is sales and cannot self-assign admin; no passwordHash leaked', async () => {
    const r = await api()
      .post('/api/auth/register')
      .send({ name: 'S', email: 'S1@Test.local', password: 'Password123!', role: 'admin' });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe('sales');
    expect(r.body.user.email).toBe('s1@test.local');
    expect(r.body.user).not.toHaveProperty('passwordHash');
    expect(typeof r.body.token).toBe('string');
  });

  it('rejects duplicate email with 409', async () => {
    const r = await api()
      .post('/api/auth/register')
      .send({ name: 'X', email: 'admin@test.local', password: 'Password123!' });
    expect(r.status).toBe(409);
  });

  it('validates register input', async () => {
    const r = await api().post('/api/auth/register').send({ name: '', email: 'bad', password: '1' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(r.body.error.details)).toBe(true);
  });

  it('login ok / wrong password / unknown email', async () => {
    const ok = await api().post('/api/auth/login').send({ email: 'admin@test.local', password: 'Password123!' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe('admin@test.local');
    const bad = await api().post('/api/auth/login').send({ email: 'admin@test.local', password: 'nope-nope' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    const unknown = await api().post('/api/auth/login').send({ email: 'ghost@test.local', password: 'nope-nope' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('GET /me requires a valid token', async () => {
    const me = await api().get('/api/auth/me').set(bearer(adminToken));
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('admin@test.local');
    expect(me.body).not.toHaveProperty('passwordHash');

    expect((await api().get('/api/auth/me')).status).toBe(401);
    expect((await api().get('/api/auth/me').set(bearer('garbage'))).status).toBe(401);
    const forged = jwt.sign({ role: 'admin' }, 'another-secret', { subject: '1' });
    expect((await api().get('/api/auth/me').set(bearer(forged))).status).toBe(401);
    const expired = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET!, { subject: '1', expiresIn: -10 });
    const r = await api().get('/api/auth/me').set(bearer(expired));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TOKEN_EXPIRED');
  });

  describe('users (admin only)', () => {
    let salesToken: string;
    let salesId: number;

    beforeAll(async () => {
      const s = await register('Sales Two', 's2@test.local');
      salesToken = s.token;
      salesId = s.user.id;
    });

    it('admin lists users without hashes; sales gets 403', async () => {
      const r = await api().get('/api/users?sort=email&order=asc').set(bearer(adminToken));
      expect(r.status).toBe(200);
      expect(r.body.total).toBeGreaterThanOrEqual(2);
      for (const u of r.body.data) expect(u).not.toHaveProperty('passwordHash');
      expect((await api().get('/api/users').set(bearer(salesToken))).status).toBe(403);
      expect((await api().get('/api/users')).status).toBe(401);
    });

    it('admin creates, updates and deletes users', async () => {
      const c = await api()
        .post('/api/users')
        .set(bearer(adminToken))
        .send({ name: 'New', email: 'new@test.local', password: 'Password123!', role: 'admin' });
      expect(c.status).toBe(201);
      expect(c.body.role).toBe('admin');
      const p = await api().patch(`/api/users/${c.body.id}`).set(bearer(adminToken)).send({ role: 'sales', name: 'Renamed' });
      expect(p.status).toBe(200);
      expect(p.body).toMatchObject({ role: 'sales', name: 'Renamed' });
      expect((await api().delete(`/api/users/${c.body.id}`).set(bearer(adminToken))).status).toBe(204);
      expect((await api().patch('/api/users/99999').set(bearer(adminToken)).send({ name: 'x' })).status).toBe(404);
      expect((await api().delete(`/api/users/${salesId}`).set(bearer(salesToken))).status).toBe(403);
    });

    it('rejects invalid sort field (whitelist)', async () => {
      const r = await api().get('/api/users?sort=passwordHash').set(bearer(adminToken));
      expect(r.status).toBe(400);
    });

    it('admin cannot delete self', async () => {
      const me = await api().get('/api/auth/me').set(bearer(adminToken));
      const r = await api().delete(`/api/users/${me.body.id}`).set(bearer(adminToken));
      expect(r.status).toBe(409);
    });
  });
});
