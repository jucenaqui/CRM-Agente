import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the /backend folder (works from src/ with tsx and from dist/ after build). */
export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me-0123456789';

/** Loads backend/.env (if present) without overriding variables already set. */
export function loadEnv(): void {
  const file = path.join(BACKEND_ROOT, '.env');
  if (!fs.existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch {
    /* ignore malformed .env */
  }
}

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';
export const isTest = (): boolean => process.env.NODE_ENV === 'test' || !!process.env.VITEST;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) return secret;
  if (isProduction()) throw new Error('JWT_SECRET must be set in production');
  return DEV_JWT_SECRET;
}

export const getJwtExpiresIn = (): string => process.env.JWT_EXPIRES_IN || '8h';

export function getBcryptRounds(): number {
  const n = Number(process.env.BCRYPT_ROUNDS);
  if (Number.isInteger(n) && n >= 4 && n <= 15) return isProduction() ? Math.max(n, 10) : n;
  return 10;
}

export const getPort = (): number => Number(process.env.PORT) || 4000;

export function getDbPath(): string {
  const p = process.env.DB_PATH;
  if (p === ':memory:') return p;
  if (!p) return path.join(BACKEND_ROOT, 'data', 'crm.db');
  return path.isAbsolute(p) ? p : path.resolve(BACKEND_ROOT, p);
}

/** Fails fast on insecure production configuration. */
export function assertConfig(): void {
  if (isProduction()) {
    const s = process.env.JWT_SECRET;
    if (!s || s.length < 32) throw new Error('JWT_SECRET (>= 32 chars) is required in production');
  }
}
