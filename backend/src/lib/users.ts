import bcrypt from 'bcryptjs';
import { getBcryptRounds } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { toPublicUser, type PublicUser, type Role, type UserRow } from './auth.js';
import { conflict } from './errors.js';

export const hashPassword = (pw: string) => bcrypt.hash(pw, getBcryptRounds());

export const findUserByEmail = (email: string) =>
  getDb().prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as
    | UserRow
    | undefined;

export const findUserById = (id: number) =>
  getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

/**
 * Inserts a user. When `role` is undefined the first user becomes `admin` and the rest `sales`
 * (count + insert run in one transaction).
 */
export function insertUser(input: {
  name: string;
  email: string;
  passwordHash: string;
  role?: Role;
}): PublicUser {
  const db = getDb();
  const tx = db.transaction(() => {
    if (findUserByEmail(input.email)) throw conflict('Email already registered', 'EMAIL_TAKEN');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    const role: Role = input.role ?? (n === 0 ? 'admin' : 'sales');
    const info = db
      .prepare(
        'INSERT INTO users (name, email, passwordHash, role, createdAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run(input.name, input.email.trim().toLowerCase(), input.passwordHash, role, nowIso());
    return findUserById(Number(info.lastInsertRowid))!;
  });
  return toPublicUser(tx());
}
