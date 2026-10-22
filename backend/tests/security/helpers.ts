/** Security test helpers. Env must be set before importing the app. */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'sec-test-secret-sec-test-secret-123456';
process.env.DB_PATH = ':memory:';
process.env.RATE_LIMIT_DISABLED = '1';

let cached: any = null;
export async function getApp(): Promise<any> {
  if (cached) return cached;
  const mod: any = await import('../../src/app');
  let candidate = mod.app ?? mod.default ?? mod.createApp;
  if (typeof candidate === 'function' && !candidate.use && !candidate.handle) {
    candidate = await candidate();
  }
  cached = candidate;
  return cached;
}

export async function api() {
  return request(await getApp());
}

let n = 0;
export async function register(name: string) {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s+/g, '')}.${Date.now()}.${n}@sec.test`;
  const password = 'Password123!';
  const r = await (await api()).post('/api/auth/register').send({ name, email, password });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`register failed ${r.status}: ${JSON.stringify(r.body)}`);
  }
  return { token: r.body.token as string, user: r.body.user, email, password };
}

export const auth = (s: { token: string }) => ({ Authorization: `Bearer ${s.token}` });

/** Recursively checks that no key named passwordHash/password_hash exists. */
export function containsPasswordHash(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPasswordHash);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => /^password(_?hash)?$/i.test(k) || containsPasswordHash(v),
    );
  }
  if (typeof value === 'string') return /^\$2[aby]\$\d{2}\$/.test(value);
  return false;
}
