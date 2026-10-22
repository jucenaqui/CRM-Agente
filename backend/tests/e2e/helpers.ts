/**
 * QA e2e helpers. Each test file runs in its own vitest worker/module graph,
 * so importing the app gives a fresh in-memory database per file.
 */
import request from 'supertest';
import { expect } from 'vitest';

// Environment must be set BEFORE the app (and its db module) is imported.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'qa-test-secret-qa-test-secret-123456';
process.env.DB_PATH = ':memory:';
process.env.DATABASE_PATH = ':memory:';
process.env.SQLITE_PATH = ':memory:';
process.env.DATABASE_URL = ':memory:';
process.env.RATE_LIMIT_DISABLED = '1';

type AnyApp = any;
let cached: AnyApp | null = null;

export async function getApp(): Promise<AnyApp> {
  if (cached) return cached;
  const mod: any = await import('../../src/app');
  let candidate = mod.app ?? mod.default ?? mod.createApp;
  if (typeof candidate === 'function' && !candidate.use && !candidate.handle) {
    candidate = await candidate();
  } else if (!candidate && typeof mod.createApp === 'function') {
    candidate = await mod.createApp();
  }
  if (!candidate) throw new Error('Could not resolve app from src/app.ts');
  cached = candidate;
  return cached;
}

export async function api() {
  return request(await getApp());
}

export interface Session {
  token: string;
  user: any;
  email: string;
  password: string;
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@qa.test`;
}

export async function register(
  name = 'QA User',
  email = uniqueEmail(),
  password = 'Password123!',
): Promise<Session> {
  const r = await (await api()).post('/api/auth/register').send({ name, email, password });
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`register failed ${r.status}: ${JSON.stringify(r.body)}`);
  }
  return { token: r.body.token, user: r.body.user, email, password };
}

/** Registers admin (first user) + two sales users. Must be called first in a file. */
export async function setupUsers() {
  const admin = await register('Admin QA', uniqueEmail('admin'));
  const sales1 = await register('Sales One', uniqueEmail('sales1'));
  const sales2 = await register('Sales Two', uniqueEmail('sales2'));
  return { admin, sales1, sales2 };
}

export function auth(s: Session | string) {
  const token = typeof s === 'string' ? s : s.token;
  return { Authorization: `Bearer ${token}` };
}

export function expectError(res: request.Response, statuses: number | number[]) {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  expect(list, `status ${res.status} body ${JSON.stringify(res.body)}`).toContain(res.status);
  expect(res.body).toHaveProperty('error');
  expect(typeof res.body.error.code).toBe('string');
  expect(typeof res.body.error.message).toBe('string');
}

export function expectList(res: request.Response) {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(Array.isArray(res.body.data)).toBe(true);
  expect(typeof res.body.total).toBe('number');
  expect(Number(res.body.page)).toBeGreaterThanOrEqual(1);
  expect(Number(res.body.pageSize)).toBeGreaterThanOrEqual(1);
}

export const VALIDATION = [400, 422];
export const CREATED = [200, 201];
export const DELETED = [200, 204];
export const FORBIDDEN_OR_NOT_FOUND = [403, 404];
