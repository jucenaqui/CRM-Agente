import { describe, it, expect, beforeAll } from 'vitest';
import {
  api, auth, expectError, expectList, setupUsers, uniqueEmail,
  VALIDATION, CREATED, DELETED, Session,
} from './helpers';

describe('Users (admin only)', () => {
  let admin: Session, sales1: Session;
  let createdId: string | number;

  beforeAll(async () => {
    ({ admin, sales1 } = await setupUsers());
  });

  it('[U-01] admin lists users (paginated, no passwordHash)', async () => {
    const r = await (await api()).get('/api/users').set(auth(admin));
    expectList(r);
    expect(r.body.total).toBeGreaterThanOrEqual(3);
    for (const u of r.body.data) {
      expect(u).not.toHaveProperty('passwordHash');
      expect(u).not.toHaveProperty('password');
    }
  });

  it('[U-02] sales cannot list users', async () => {
    const r = await (await api()).get('/api/users').set(auth(sales1));
    expectError(r, 403);
  });

  it('[U-10] users endpoint requires auth', async () => {
    const r = await (await api()).get('/api/users');
    expectError(r, 401);
  });

  it('[U-03] admin creates a user', async () => {
    const email = uniqueEmail('created');
    const r = await (await api())
      .post('/api/users')
      .set(auth(admin))
      .send({ name: 'Created', email, password: 'Password123!', role: 'sales' });
    expect(CREATED, JSON.stringify(r.body)).toContain(r.status);
    const user = r.body.user ?? r.body;
    expect(user).toMatchObject({ email, role: 'sales' });
    expect(user).not.toHaveProperty('passwordHash');
    createdId = user.id;

    const login = await (await api()).post('/api/auth/login').send({ email, password: 'Password123!' });
    expect(login.status).toBe(200);
  });

  it('[U-03] admin can create another admin', async () => {
    const r = await (await api())
      .post('/api/users')
      .set(auth(admin))
      .send({ name: 'Admin 2', email: uniqueEmail('admin2'), password: 'Password123!', role: 'admin' });
    expect(CREATED).toContain(r.status);
    expect((r.body.user ?? r.body).role).toBe('admin');
  });

  it('[U-04] admin create with duplicate email returns 409', async () => {
    const r = await (await api())
      .post('/api/users')
      .set(auth(admin))
      .send({ name: 'Dup', email: sales1.email, password: 'Password123!', role: 'sales' });
    expectError(r, 409);
  });

  it('[U-05] admin create with invalid data returns 400/422', async () => {
    const r = await (await api())
      .post('/api/users')
      .set(auth(admin))
      .send({ name: '', email: 'bad', password: '1', role: 'superuser' });
    expectError(r, VALIDATION);
  });

  it('[U-07] sales cannot create users', async () => {
    const r = await (await api())
      .post('/api/users')
      .set(auth(sales1))
      .send({ name: 'X', email: uniqueEmail('x'), password: 'Password123!', role: 'admin' });
    expectError(r, 403);
  });

  it('[U-06] admin patches a user', async () => {
    const r = await (await api())
      .patch(`/api/users/${createdId}`)
      .set(auth(admin))
      .send({ name: 'Renamed', role: 'admin' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const user = r.body.user ?? r.body;
    expect(user).toMatchObject({ name: 'Renamed', role: 'admin' });
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('[U-06] admin patch with invalid role returns 400/422', async () => {
    const r = await (await api())
      .patch(`/api/users/${createdId}`)
      .set(auth(admin))
      .send({ role: 'god' });
    expectError(r, VALIDATION);
  });

  it('[U-07] sales cannot patch or delete users', async () => {
    const p = await (await api()).patch(`/api/users/${createdId}`).set(auth(sales1)).send({ name: 'x' });
    expectError(p, 403);
    const d = await (await api()).delete(`/api/users/${createdId}`).set(auth(sales1));
    expectError(d, 403);
  });

  it('[U-07] sales cannot escalate own role via PATCH /users/:id', async () => {
    const p = await (await api())
      .patch(`/api/users/${sales1.user.id}`)
      .set(auth(sales1))
      .send({ role: 'admin' });
    expectError(p, 403);
  });

  it('[U-08] admin patch/delete of non-existent user returns 404', async () => {
    const p = await (await api()).patch('/api/users/999999').set(auth(admin)).send({ name: 'x' });
    expectError(p, 404);
    const d = await (await api()).delete('/api/users/999999').set(auth(admin));
    expectError(d, 404);
  });

  it('[U-09] admin deletes a user', async () => {
    const d = await (await api()).delete(`/api/users/${createdId}`).set(auth(admin));
    expect(DELETED, JSON.stringify(d.body)).toContain(d.status);
    const list = await (await api()).get('/api/users?pageSize=100').set(auth(admin));
    expect(list.body.data.find((u: any) => String(u.id) === String(createdId))).toBeUndefined();
  });

  it('[U-01] users list supports search', async () => {
    const r = await (await api()).get('/api/users?search=Sales%20One').set(auth(admin));
    expectList(r);
    expect(r.body.data.length).toBeGreaterThanOrEqual(1);
    expect(r.body.data.every((u: any) => /sales one/i.test(u.name) || /sales one/i.test(u.email))).toBe(true);
  });
});
