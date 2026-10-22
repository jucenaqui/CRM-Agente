import express, { type Express, type RequestHandler } from 'express';
import { isTest } from './config.js';
import { mountCrmRoutes, mountErrorHandlers } from './core.js';
import { requireAuth } from './lib/auth.js';
// Security hook (owned by the Security agent): helmet, CORS, body limit, rate limiting.
import { applySecurity } from './middleware/security.js';
import agentRouter from './routes/agent.js';
import mcpRouter from './routes/mcp.js';
import tokensRouter from './routes/tokens.js';

const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // No bodies/headers logged (may contain credentials or tokens).
    console.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
};

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  applySecurity(app);
  if (!isTest()) app.use(requestLogger);
  app.use(express.json({ limit: '100kb' })); // no-op if security already parsed the body

  mountCrmRoutes(app);
  app.use('/api/agent', requireAuth, agentRouter);
  app.use('/api/tokens', requireAuth, tokensRouter);
  app.use('/api/mcp', mcpRouter); // own auth: personal tokens, not JWT

  mountErrorHandlers(app);
  return app;
}

export const app = createApp();
export default app;
