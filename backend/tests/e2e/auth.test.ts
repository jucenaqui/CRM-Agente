import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { api, auth, expectError, uniqueEmail, VALIDATION, CREATED, Session } from './helpers';

describe('Health & routing', () => {
  it('[H-01] GET /api/health without auth', async () => {
    const r = await (await api()).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual(expect.objectContaining({ status: 'ok' }));
  });

  it('[H-02] unknown API route returns 404 with error format', async () => {
    const r = await (await api()).get('/api/does-not-exist');
    expectError(r, 404);
  });
});

describe('Auth', () => {
  const adminEmail = uniqueEmail('first');
  const password = 'Password123!';
  let admin: Session;

  beforeAll(async () => {
    const r = await (await api())
      .post('/api/auth/register')
      .send({ name: 'First Admin', email: adminEmail, password });
    expect(CREATED, JSON.stringify(r.body)).toContain(r.status);
    admin = { token: r.body.token, user: r.body.user, email: adminEmail, password };
  });

  it('[A-01] first registered user is admin and response shape is correct', () => {
    expect(typeof admin.token).toBe('string');
    expect(admin.user).toMatchObject({ name: 'First Admin', email: adminEmail, role: 'admin' });
    expect(admin.user).toHaveProperty('id');
    expect(admin.user).not.toHaveProperty('passwordHash');
    expect(admin.user).not.toHaveProperty('password');
  });

  it('[A-02] second registered user is sales', async () => {
    const r = await (await api())
      .post('/api/auth/register')
      .send({ name: 'Second', email: uniqueEmail('second'), password });
    expect(CREATED).toContain(r.status);
    expect(r.body.user.role).toBe('sales');
    expect(r.body.user).not.toHaveProperty('passwordHash');
  });

  it('[A-12] register cannot self-assign admin role', async () => {
    const r = await (await api())
      .post('/api/auth/register')
      .send({ name: 'Sneaky', email: uniqueEmail('sneaky'), password, role: 'admin' });
    expect(CREATED).toContain(r.status);
    expect(r.body.user.role).toBe('sales');
  });

  it('[A-03] duplicate email returns 409', async () => {
    const r = await (await api())
      .post('/api/auth/register')
      .send({ name: 'Dup', email: adminEmail, password });
    expectError(r, 409);
  });

  it('[A-03b] duplicate email is case-insensitive or at least not 500', async () => {
    const r = await (await api())
      .post('/api/auth/register')
      .send({ name: 'Dup', email: adminEmail.toUpperCase(), password });
    expect(r.status).not.toBe(500);
  });

  it('[A-04] register validation: missing fields', async () => {
    const r = await (await api()).post('/api/auth/register').send({});
    expectError(r, VALIDATION);
  });

  it('[A-04] register validation: invalid email', async () => {
    const r = await (await api())
      .post('/api/auth/register')
      .send({ name: 'X', email: 'not-an-email', password });
    expectError(r, VALIDATION);
  });

  it('[A-04] register validation: short password', async () => {
    const r = await (await api())
      .post('/api/auth/register')
      .send({ name: 'X', email: uniqueEmail('short'), password: '1' });
    expectError(r, VALIDATION);
  });

  it('[A-05] login with correct credentials', async () => {
    const r = await (await api()).post('/api/auth/login').send({ email: adminEmail, password });
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe('string');
    expect(r.body.user).toMatchObject({ email: adminEmail, role: 'admin' });
    expect(r.body.user).not.toHaveProperty('passwordHash');
  });

  it('[A-06] login with wrong password returns 401', async () => {
    const r = await (await api())
      .post('/api/auth/login')
      .send({ email: adminEmail, password: 'WrongPassword!' });
    expectError(r, 401);
  });

  it('[A-07] login with unknown email returns 401', async () => {
    const r = await (await api())
      .post('/api/auth/login')
      .send({ email: uniqueEmail('ghost'), password });
    expectError(r, 401);
  });

  it('[A-08] login with invalid body returns 400/422', async () => {
    const r = await (await api()).post('/api/auth/login').send({ email: 'x' });
    expectError(r, [...VALIDATION, 401]);
  });

  it('[A-09] GET /me returns current user', async () => {
    const r = await (await api()).get('/api/auth/me').set(auth(admin));
    expect(r.status).toBe(200);
    const user = r.body.user ?? r.body;
    expect(user).toMatchObject({ email: adminEmail, role: 'admin', id: admin.user.id });
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('[A-10] GET /me without token returns 401', async () => {
    const r = await (await api()).get('/api/auth/me');
    expectError(r, 401);
  });

  it('[A-11] GET /me with malformed token returns 401', async () => {
    const r = await (await api()).get('/api/auth/me').set({ Authorization: 'Bearer garbage.token.here' });
    expectError(r, 401);
  });

  it('[A-11] GET /me with token signed by another secret returns 401', async () => {
    const forged = jwt.sign({ sub: admin.user.id, id: admin.user.id, role: 'admin' }, 'another-secret');
    const r = await (await api()).get('/api/auth/me').set(auth(forged));
    expectError(r, 401);
  });

  it('[A-11] Authorization header without Bearer prefix returns 401', async () => {
    const r = await (await api()).get('/api/auth/me').set({ Authorization: admin.token });
    expectError(r, 401);
  });

  it('[E-02] malformed JSON body returns 400 with error format', async () => {
    const r = await (await api())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": bad json');
    expectError(r, 400);
  });
});
