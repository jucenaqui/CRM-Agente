import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySecurity } from '../../src/middleware/security';

const saved = { ...process.env };

function buildApp() {
  const app = express();
  applySecurity(app);
  app.post('/api/auth/login', (_req, res) => {
    res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
  });
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  return app;
}

describe('applySecurity rate limiting', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.RATE_LIMIT_DISABLED;
    process.env.AUTH_RATE_LIMIT_MAX = '3';
  });
  afterAll(() => {
    process.env = saved;
  });

  it('blocks brute force on /api/auth/login with 429 in contract format', async () => {
    const app = buildApp();
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post('/api/auth/login').send({})).status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('is disabled when RATE_LIMIT_DISABLED=1', async () => {
    process.env.RATE_LIMIT_DISABLED = '1';
    const app = buildApp();
    for (let i = 0; i < 6; i++) {
      expect((await request(app).post('/api/auth/login').send({})).status).toBe(401);
    }
    delete process.env.RATE_LIMIT_DISABLED;
  });

  it('rejects bodies over 100kb', async () => {
    process.env.RATE_LIMIT_DISABLED = '1';
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ x: 'a'.repeat(110 * 1024) });
    expect(res.status).toBe(413);
  });

  it('sets CORS only for the configured origin', async () => {
    process.env.CORS_ORIGIN = 'http://allowed.test';
    const app = buildApp();
    const ok = await request(app).get('/api/health').set('Origin', 'http://allowed.test');
    expect(ok.headers['access-control-allow-origin']).toBe('http://allowed.test');
    const bad = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    expect(ok.headers['x-powered-by']).toBeUndefined();
  });
});
