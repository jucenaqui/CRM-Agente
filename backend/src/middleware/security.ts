import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

/**
 * Security middleware (owned by the Security agent).
 * Call `applySecurity(app)` BEFORE registering routes.
 *
 * Env:
 *  - CORS_ORIGIN: comma-separated allowed origins (default http://localhost:5173)
 *  - RATE_LIMIT_DISABLED=1 or NODE_ENV=test: disables rate limiting
 *  - RATE_LIMIT_MAX / AUTH_RATE_LIMIT_MAX: override limits per window
 */

export const BODY_LIMIT = '100kb';

function rateLimitDisabled(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.RATE_LIMIT_DISABLED === '1';
}

function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function tooManyRequests(_req: Request, res: Response): void {
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' },
  });
}

export function applySecurity(app: Express): void {
  app.disable('x-powered-by');
  // Only trust a proxy when explicitly configured (avoid X-Forwarded-For spoofing of rate limits).
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  const origins = allowedOrigins();
  app.use(
    cors({
      origin: (origin, cb) => {
        // Non-browser clients (curl, supertest, same-origin via Vite proxy) send no Origin.
        if (!origin || origins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: false,
      maxAge: 600,
    }),
  );

  // Body size limit. Later express.json() calls are no-ops once the body is parsed.
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT }));

  const windowMs = 15 * 60 * 1000;

  const authLimiter = rateLimit({
    windowMs,
    limit: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: rateLimitDisabled,
    skipSuccessfulRequests: true, // count only failed attempts (brute force)
    handler: tooManyRequests,
  });

  const generalLimiter = rateLimit({
    windowMs,
    limit: Number(process.env.RATE_LIMIT_MAX ?? 300),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: rateLimitDisabled,
    handler: tooManyRequests,
  });

  // Register: count every attempt (account spam), not only failures.
  const registerLimiter = rateLimit({
    windowMs,
    limit: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: rateLimitDisabled,
    handler: tooManyRequests,
  });

  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', registerLimiter);
  app.use('/api', generalLimiter);
}

export default applySecurity;
