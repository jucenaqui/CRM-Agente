import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtExpiresIn, getJwtSecret } from '../config.js';
import { getDb } from '../db.js';
import { forbidden, unauthorized } from './errors.js';

export type Role = 'admin' | 'sales';

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface UserRow extends PublicUser {
  passwordHash: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export function toPublicUser(row: UserRow | PublicUser): PublicUser {
  return { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.createdAt };
}

export function signToken(user: PublicUser): string {
  return jwt.sign({ role: user.role }, getJwtSecret(), {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: getJwtExpiresIn() as jwt.SignOptions['expiresIn'],
  });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !/^Bearer\s+\S+$/i.test(header)) throw unauthorized();
  const token = header.replace(/^Bearer\s+/i, '');
  let sub: string | undefined;
  try {
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
    sub = typeof payload === 'object' ? payload.sub : undefined;
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) throw unauthorized('Token expired', 'TOKEN_EXPIRED');
    throw unauthorized('Invalid token', 'INVALID_TOKEN');
  }
  const id = Number(sub);
  if (!Number.isInteger(id)) throw unauthorized('Invalid token', 'INVALID_TOKEN');
  // Reload from DB so deleted users / role changes take effect immediately.
  const row = getDb()
    .prepare('SELECT id, name, email, role, createdAt FROM users WHERE id = ?')
    .get(id) as PublicUser | undefined;
  if (!row) throw unauthorized('Invalid token', 'INVALID_TOKEN');
  req.user = row;
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };

export const currentUser = (req: Request): PublicUser => {
  if (!req.user) throw unauthorized();
  return req.user;
};

export const isAdmin = (req: Request): boolean => req.user?.role === 'admin';
