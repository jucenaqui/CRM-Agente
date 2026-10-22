import { Router, type Request, type RequestHandler, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AGENT_TOOLS, executeTool } from '../agent/tools.js';
import { getDb, nowIso } from '../db.js';
import { signToken, type PublicUser } from '../lib/auth.js';
import { hashToken, TOKEN_PREFIX } from './tokens.js';

/**
 * MCP server (Streamable HTTP transport, stateless, JSON responses) exposing the same CRM
 * tools as the in-app assistant. Authenticated with a personal token (ncrm_...); every tool
 * call runs as that user through the regular API, so validation and ownership rules apply.
 * The AI itself runs in the customer's own app (Claude Code, Claude Desktop...), on their plan.
 */
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST_VERSION = SUPPORTED_VERSIONS[0];

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: Record<string, unknown>;
}

const rpcError = (id: JsonRpcRequest['id'], code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  id: id ?? null,
  error: { code, message },
});
const rpcResult = (id: JsonRpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0' as const, id: id ?? null, result });

const rateLimitDisabled = () => process.env.NODE_ENV === 'test' || process.env.RATE_LIMIT_DISABLED === '1';

const limiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.MCP_RATE_LIMIT_MAX ?? 120),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: rateLimitDisabled,
  keyGenerator: (req) => `mcp:${(req as Request).user?.id ?? 'anon'}`,
  handler: (_req, res) => {
    res.status(429).json(rpcError(null, -32000, 'Demasiadas peticiones; inténtalo en un minuto.'));
  },
});

const deny = (res: Response) => {
  res.status(401).set('WWW-Authenticate', 'Bearer').json(rpcError(null, -32001, 'Token inválido, revocado o ausente'));
};

const authenticate: RequestHandler = (req, res, next) => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (!m || !m[1].startsWith(TOKEN_PREFIX)) return deny(res);
  const db = getDb();
  const row = db
    .prepare(
      `SELECT t.id AS tokenId, t.lastUsedAt AS lastUsedAt, u.id, u.name, u.email, u.role, u.createdAt
       FROM api_tokens t JOIN users u ON u.id = t.userId
       WHERE t.tokenHash = ? AND t.revokedAt IS NULL`,
    )
    .get(hashToken(m[1])) as (PublicUser & { tokenId: number; lastUsedAt: string | null }) | undefined;
  if (!row) return deny(res);
  const now = nowIso();
  if (!row.lastUsedAt || Date.parse(now) - Date.parse(row.lastUsedAt) > 60_000) {
    db.prepare('UPDATE api_tokens SET lastUsedAt = ? WHERE id = ?').run(now, row.tokenId);
  }
  req.user = { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.createdAt };
  next();
};

async function dispatch(msg: JsonRpcRequest, user: PublicUser): Promise<object | null> {
  const isNotification = msg.id === undefined;
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return isNotification ? null : rpcError(msg.id, -32600, 'Invalid Request');
  }
  const params = msg.params ?? {};

  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : LATEST_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'newcrm', version: '1.0.0' },
        instructions:
          'Herramientas del CRM NEWCRM. Actúas con los permisos del usuario dueño del token. Busca con list_records antes de modificar o borrar, y no inventes ids.',
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, {
        tools: AGENT_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })),
      });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string' || !AGENT_TOOLS.some((t) => t.name === name)) {
        return rpcError(msg.id, -32602, `Herramienta desconocida: ${String(name)}`);
      }
      const outcome = await executeTool(name, params.arguments ?? {}, signToken(user));
      return rpcResult(msg.id, { content: [{ type: 'text', text: outcome.content }], isError: !outcome.ok });
    }
    default:
      // Notifications (notifications/initialized, notifications/cancelled...) get no reply.
      return isNotification ? null : rpcError(msg.id, -32601, `Método no soportado: ${msg.method}`);
  }
}

const router = Router();

router.post('/', authenticate, limiter, async (req, res) => {
  const body: unknown = req.body;
  const user = req.user!;
  try {
    if (Array.isArray(body)) {
      if (body.length === 0) return void res.status(400).json(rpcError(null, -32600, 'Invalid Request'));
      const replies = (await Promise.all(body.map((m) => dispatch(m as JsonRpcRequest, user)))).filter((r) => r !== null);
      return void (replies.length ? res.json(replies) : res.status(202).end());
    }
    if (typeof body !== 'object' || body === null) {
      return void res.status(400).json(rpcError(null, -32600, 'Invalid Request'));
    }
    const reply = await dispatch(body as JsonRpcRequest, user);
    if (reply === null) return void res.status(202).end();
    res.json(reply);
  } catch {
    res.status(500).json(rpcError((body as JsonRpcRequest | null)?.id, -32603, 'Error interno'));
  }
});

// No server-initiated stream / sessions: tell clients to use POST only.
const methodNotAllowed: RequestHandler = (_req, res) => {
  res.status(405).set('Allow', 'POST').json(rpcError(null, -32000, 'Method not allowed'));
};
router.get('/', methodNotAllowed);
router.delete('/', methodNotAllowed);

export default router;
