import express, { type ErrorRequestHandler, type Express } from 'express';
import { isProduction, isTest } from './config.js';
import { requireAuth } from './lib/auth.js';
import { HttpError, notFound } from './lib/errors.js';
import activitiesRouter from './routes/activities.js';
import authRouter from './routes/auth.js';
import companiesRouter from './routes/companies.js';
import contactsRouter from './routes/contacts.js';
import dashboardRouter from './routes/dashboard.js';
import dealsRouter from './routes/deals.js';
import usersRouter from './routes/users.js';

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    const error: Record<string, unknown> = { code: err.code, message: err.message };
    if (err.details !== undefined) error.details = err.details;
    res.status(err.status).json({ error });
    return;
  }
  // body-parser errors (malformed JSON, payload too large, ...)
  const e = err as { type?: string; status?: number; statusCode?: number };
  const status = e.status ?? e.statusCode;
  if (e.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
    return;
  }
  if (e.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
    return;
  }
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'Bad request' } });
    return;
  }
  if (!isTest()) console.error(err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction() ? 'Internal server error' : String((err as Error)?.message ?? err),
    },
  });
};

/** CRM resource routes (everything the UI and the agent operate on). */
export function mountCrmRoutes(app: Express): void {
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/companies', requireAuth, companiesRouter);
  app.use('/api/contacts', requireAuth, contactsRouter);
  app.use('/api/deals', requireAuth, dealsRouter);
  app.use('/api/activities', requireAuth, activitiesRouter);
  app.use('/api/dashboard', requireAuth, dashboardRouter);
}

/** 404 + contract-format error handler; must be mounted last. */
export function mountErrorHandlers(app: Express): void {
  app.use((_req, _res, next) => next(notFound('Route not found')));
  app.use(errorHandler);
}

/**
 * The CRM API without the public-facing layer (helmet, CORS, rate limits, request log).
 * The agent dispatches its tool calls here in-process, with the caller's own token,
 * so validation and ownership rules are exactly the ones the UI goes through.
 */
export function createCoreApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  mountCrmRoutes(app);
  mountErrorHandlers(app);
  return app;
}
