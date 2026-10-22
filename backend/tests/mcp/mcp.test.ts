import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_TOOLS } from '../../src/agent/tools';
import { app } from '../../src/app';
import { getDb } from '../../src/db';

let seq = 0;
async function reg() {
  const r = await request(app)
    .post('/api/auth/register')
    .send({ name: `Mcp ${++seq}`, email: `mcp-${seq}@test.local`, password: 'Password123!' });
  return { jwt: r.body.token as string, id: r.body.user.id as number };
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
async function newToken(jwt: string, name = 'Claude Code') {
  const r = await request(app).post('/api/tokens').set(bearer(jwt)).send({ name });
  expect(r.status).toBe(201);
  return r.body as { id: number; token: string; tokenPrefix: string };
}
const rpc = (token: string | undefined, body: unknown) =>
  request(app)
    .post('/api/mcp')
    .set(token ? bearer(token) : {})
    .send(body as object);

let admin: { jwt: string; id: number };
let alice: { jwt: string; id: number };
let bob: { jwt: string; id: number };

beforeAll(async () => {
  admin = await reg();
  alice = await reg();
  bob = await reg();
});

describe('personal tokens', () => {
  it('are shown once, stored hashed, listed without the secret and revocable', async () => {
    const t = await newToken(alice.jwt, 'Mi portátil');
    expect(t.token).toMatch(/^ncrm_[A-Za-z0-9_-]{40,}$/);
    const stored = getDb().prepare('SELECT tokenHash FROM api_tokens WHERE id = ?').get(t.id) as { tokenHash: string };
    expect(stored.tokenHash).not.toContain(t.token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const list = await request(app).get('/api/tokens').set(bearer(alice.jwt));
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(t.token);
    expect(list.body.data[0]).toMatchObject({ name: 'Mi portátil', tokenPrefix: t.tokenPrefix });

    expect((await rpc(t.token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200);
    expect((await request(app).delete(`/api/tokens/${t.id}`).set(bearer(alice.jwt))).status).toBe(204);
    expect((await rpc(t.token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
    expect((await request(app).get('/api/tokens').set(bearer(alice.jwt))).body.data).toEqual([]);
  });

  it('cannot be revoked by someone else, and a token cannot create tokens or use the regular API', async () => {
    const t = await newToken(alice.jwt);
    expect((await request(app).delete(`/api/tokens/${t.id}`).set(bearer(bob.jwt))).status).toBe(404);
    expect((await rpc(t.token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200);
    expect((await request(app).post('/api/tokens').set(bearer(t.token)).send({ name: 'x' })).status).toBe(401);
    expect((await request(app).get('/api/companies').set(bearer(t.token))).status).toBe(401);
  });

  it('are limited to 10 active per user', async () => {
    const carol = await reg();
    for (let i = 0; i < 10; i++) await newToken(carol.jwt, `t${i}`);
    const r = await request(app).post('/api/tokens').set(bearer(carol.jwt)).send({ name: 'una más' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('TOKEN_LIMIT');
  });

  it('die with their user', async () => {
    const dave = await reg();
    const t = await newToken(dave.jwt);
    expect((await request(app).delete(`/api/users/${dave.id}`).set(bearer(admin.jwt))).status).toBe(204);
    expect((await rpc(t.token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
  });
});

describe('MCP endpoint (raw protocol)', () => {
  it('rejects missing, malformed and JWT credentials', async () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
    expect((await rpc(undefined, body)).status).toBe(401);
    expect((await rpc('ncrm_nope', body)).status).toBe(401);
    expect((await rpc(alice.jwt, body)).status).toBe(401); // a JWT is not an MCP token
    const noBearer = await request(app).post('/api/mcp').set('Authorization', 'Token abc').send(body);
    expect(noBearer.status).toBe(401);
    expect(noBearer.headers['www-authenticate']).toBe('Bearer');
  });

  it('negotiates the protocol version and lists the same tools as the assistant', async () => {
    const { token } = await newToken(alice.jwt);
    const init = await rpc(token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    expect(init.body.result).toMatchObject({ protocolVersion: '2025-03-26', serverInfo: { name: 'newcrm' } });
    expect(init.body.result.capabilities.tools).toBeDefined();
    const future = await rpc(token, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } });
    expect(future.body.result.protocolVersion).toBe('2025-06-18');

    const list = await rpc(token, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual(AGENT_TOOLS.map((t) => t.name));
    expect(list.body.result.tools[0]).toHaveProperty('inputSchema');
  });

  it('answers notifications with 202 and unknown things with JSON-RPC errors', async () => {
    const { token } = await newToken(alice.jwt);
    expect((await rpc(token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    expect((await rpc(token, { jsonrpc: '2.0', id: 1, method: 'resources/list' })).body.error.code).toBe(-32601);
    expect((await rpc(token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'rm_rf' } })).body.error.code).toBe(-32602);
    expect((await rpc(token, [])).status).toBe(400);
    const batch = await rpc(token, [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]);
    expect(batch.body).toHaveLength(1);
    expect((await request(app).get('/api/mcp').set(bearer(token))).status).toBe(405);
  });

  it('runs tools as the token owner: own data yes, other users’ data and admin tools no', async () => {
    const a = await newToken(alice.jwt);
    const b = await newToken(bob.jwt);
    const call = (token: string, name: string, args: object) =>
      rpc(token, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }).then((r) => r.body.result);

    const created = await call(a.token, 'create_company', { name: 'Acme MCP' });
    expect(created.isError).toBe(false);
    const company = JSON.parse(created.content[0].text);
    expect(company).toMatchObject({ name: 'Acme MCP', ownerId: alice.id });

    const seen = await call(b.token, 'get_record', { entity: 'companies', id: company.id });
    expect(seen.isError).toBe(true);
    expect(JSON.parse(seen.content[0].text).status).toBe(404);
    const del = await call(b.token, 'delete_record', { entity: 'companies', id: company.id });
    expect(del.isError).toBe(true);
    const users = await call(b.token, 'list_records', { entity: 'users' });
    expect(JSON.parse(users.content[0].text).status).toBe(403);

    const adminTok = await newToken(admin.jwt);
    const asAdmin = await call(adminTok.token, 'list_records', { entity: 'users' });
    expect(asAdmin.isError).toBe(false);

    const bad = await call(a.token, 'create_company', { name: '' });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0].text).status).toBe(400);

    const own = await call(a.token, 'delete_record', { entity: 'companies', id: company.id });
    expect(own.isError).toBe(false);
  });
});

describe('MCP endpoint (official SDK client over real HTTP)', () => {
  let server: Server;
  let url: URL;

  beforeAll(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`);
  });
  afterAll(() => {
    server.close();
  });

  async function connect(token: string) {
    const client = new Client({ name: 'sdk-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: bearer(token) } }));
    return client;
  }

  it('connects, lists tools and calls them like Claude Code / Desktop would', async () => {
    const { token } = await newToken(alice.jwt, 'sdk');
    const client = await connect(token);
    try {
      expect(client.getServerVersion()).toMatchObject({ name: 'newcrm' });
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(AGENT_TOOLS.map((t) => t.name));

      const created = await client.callTool({ name: 'create_company', arguments: { name: 'Via SDK', website: 'sdk.io' } });
      expect(created.isError).toBeFalsy();
      const text = (created.content as { type: string; text: string }[])[0].text;
      expect(JSON.parse(text)).toMatchObject({ name: 'Via SDK', website: 'https://sdk.io', ownerId: alice.id });

      const failed = await client.callTool({ name: 'get_record', arguments: { entity: 'companies', id: 999999 } });
      expect(failed.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('refuses a revoked token', async () => {
    const t = await newToken(alice.jwt, 'sdk-revoked');
    await request(app).delete(`/api/tokens/${t.id}`).set(bearer(alice.jwt));
    await expect(connect(t.token)).rejects.toThrow();
  });
});
