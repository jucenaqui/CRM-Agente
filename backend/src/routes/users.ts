import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { currentUser, requireAuth, requireRole, toPublicUser, type UserRow } from '../lib/auth.js';
import { parseIdParam } from '../lib/crud.js';
import { conflict, notFound } from '../lib/errors.js';
import { findUserByEmail, findUserById, hashPassword, insertUser } from '../lib/users.js';
import { email, likePattern, parseList, password, reqText, validate } from '../lib/validation.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const role = z.enum(['admin', 'sales']);
const createSchema = z.strictObject({
  name: reqText(100),
  email: email(),
  password: password(),
  role: role.optional(),
});
const updateSchema = z
  .strictObject({ name: reqText(100), email: email(), password: password(), role })
  .partial();

const SORTABLE = ['name', 'email', 'role', 'createdAt'] as const;

const countAdmins = () =>
  (getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;

router.get('/', (req, res) => {
  const q = req.query as Record<string, unknown>;
  const lp = parseList(q, SORTABLE);
  const where: string[] = [];
  const params: unknown[] = [];
  if (lp.search) {
    where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')");
    const p = likePattern(lp.search);
    params.push(p, p);
  }
  if (q.role === 'admin' || q.role === 'sales') {
    where.push('role = ?');
    params.push(q.role);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM users ${w}`).get(...params) as {
    total: number;
  };
  const sort = lp.sort ?? 'createdAt';
  const order = lp.order === 'asc' ? 'ASC' : 'DESC';
  const rows = db
    .prepare(
      `SELECT * FROM users ${w} ORDER BY ${sort} COLLATE NOCASE ${order}, id ${order} LIMIT ? OFFSET ?`,
    )
    .all(...params, lp.pageSize, (lp.page - 1) * lp.pageSize) as UserRow[];
  res.json({ data: rows.map(toPublicUser), total, page: lp.page, pageSize: lp.pageSize });
});

router.post('/', async (req, res) => {
  const body = validate(createSchema, req.body ?? {});
  const passwordHash = await hashPassword(body.password);
  const user = insertUser({
    name: body.name,
    email: body.email,
    passwordHash,
    role: body.role ?? 'sales',
  });
  res.status(201).json(user);
});

router.get('/:id', (req, res) => {
  const row = findUserById(parseIdParam(req.params.id));
  if (!row) throw notFound('User not found');
  res.json(toPublicUser(row));
});

router.patch('/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  const existing = findUserById(id);
  if (!existing) throw notFound('User not found');
  const body = validate(updateSchema, req.body ?? {});
  if (body.email && body.email !== existing.email) {
    const other = findUserByEmail(body.email);
    if (other && other.id !== id) throw conflict('Email already registered', 'EMAIL_TAKEN');
  }
  if (existing.role === 'admin' && body.role === 'sales' && countAdmins() <= 1) {
    throw conflict('Cannot demote the last admin', 'LAST_ADMIN');
  }
  const fields: Record<string, unknown> = {};
  if (body.name !== undefined) fields.name = body.name;
  if (body.email !== undefined) fields.email = body.email;
  if (body.role !== undefined) fields.role = body.role;
  if (body.password !== undefined) fields.passwordHash = await hashPassword(body.password);
  const keys = Object.keys(fields);
  if (keys.length) {
    getDb()
      .prepare(`UPDATE users SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @__id`)
      .run({ ...fields, __id: id });
  }
  res.json(toPublicUser(findUserById(id)!));
});

router.delete('/:id', (req, res) => {
  const id = parseIdParam(req.params.id);
  const me = currentUser(req);
  const existing = findUserById(id);
  if (!existing) throw notFound('User not found');
  if (id === me.id) throw conflict('You cannot delete your own account', 'CANNOT_DELETE_SELF');
  if (existing.role === 'admin' && countAdmins() <= 1) {
    throw conflict('Cannot delete the last admin', 'LAST_ADMIN');
  }
  const db = getDb();
  // Records owned by the deleted user are reassigned to the admin performing the deletion.
  db.transaction(() => {
    for (const t of ['companies', 'contacts', 'deals', 'activities']) {
      db.prepare(`UPDATE ${t} SET ownerId = ? WHERE ownerId = ?`).run(me.id, id);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  })();
  res.status(204).end();
});

export default router;
