import Anthropic from '@anthropic-ai/sdk';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setAgentLLM, setKeyValidator, type AgentLLM } from '../../src/agent/llm';
import { app } from '../../src/app';
import { getDb } from '../../src/db';

const PROVIDER = 'sk-ant-provider-key-0123456789abcdef';
const CUSTOMER = 'sk-ant-customer-key-0123456789abcdWXYZ';

let seq = 0;
async function reg() {
  const r = await request(app)
    .post('/api/auth/register')
    .send({ name: `Keys ${++seq}`, email: `keys-${seq}@test.local`, password: 'Password123!' });
  return r.body.token as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let admin: string;
let sales: string;

beforeAll(async () => {
  admin = await reg(); // first user: admin
  sales = await reg();
});

afterEach(() => {
  setAgentLLM(null);
  setKeyValidator(null);
  for (const k of ['AGENT_KEY_POLICY', 'AGENT_FALLBACK_MONTHLY_CAP_USD']) delete process.env[k];
  process.env.ANTHROPIC_API_KEY = PROVIDER;
  getDb().exec('DELETE FROM app_settings; DELETE FROM agent_usage;');
});

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = PROVIDER;
});

const apiError = (status: 400 | 401 | 429, message: string) => {
  const body = { type: 'error', error: { type: 'x', message } };
  if (status === 400) return new Anthropic.BadRequestError(400, body, message, new Headers());
  if (status === 401) return new Anthropic.AuthenticationError(401, body, message, new Headers());
  return new Anthropic.RateLimitError(429, body, message, new Headers());
};
const CREDIT = () => apiError(400, 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');

const okReply = (text: string) =>
  ({
    id: 'msg_x',
    type: 'message',
    role: 'assistant',
    model: 'fake',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }) as unknown as Anthropic.Beta.BetaMessage;

/** Fake Claude whose behaviour depends on which key is used. Returns the keys it saw, in order. */
function fakeByKey(behaviour: Record<string, 'ok' | Error>) {
  const seen: string[] = [];
  const llm: AgentLLM = {
    stream(_params, apiKey) {
      seen.push(apiKey);
      return {
        on: () => undefined,
        async finalMessage() {
          const b = behaviour[apiKey];
          if (b === undefined) throw new Error(`unexpected key ${apiKey}`);
          if (b instanceof Error) throw b;
          return okReply('hola');
        },
      };
    },
  };
  setAgentLLM(llm);
  return seen;
}

async function chat(token: string, message = 'hola') {
  const res = await request(app)
    .post('/api/agent/chat')
    .set(auth(token))
    .send({ message })
    .buffer(true)
    .parse((r, cb) => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (d += c));
      r.on('end', () => cb(null, d));
    });
  const raw = typeof res.body === 'string' ? res.body : '';
  const events = raw
    .split('\n\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as { type: string; code?: string; message?: string });
  return { res, events };
}

const saveCustomerKey = async () => {
  setKeyValidator(async () => undefined);
  const r = await request(app).put('/api/agent/settings/customer-key').set(auth(admin)).send({ apiKey: CUSTOMER });
  expect(r.status).toBe(200);
};
const settings = async () => (await request(app).get('/api/agent/settings').set(auth(admin))).body;
const usageRows = () =>
  getDb().prepare('SELECT keySource, viaFallback, costUsd FROM agent_usage ORDER BY id').all() as {
    keySource: string;
    viaFallback: number;
    costUsd: number;
  }[];

describe('customer key settings', () => {
  it('is admin-only', async () => {
    for (const call of [
      request(app).get('/api/agent/settings').set(auth(sales)),
      request(app).put('/api/agent/settings/customer-key').set(auth(sales)).send({ apiKey: CUSTOMER }),
      request(app).delete('/api/agent/settings/customer-key').set(auth(sales)),
      request(app).get('/api/agent/usage').set(auth(sales)),
    ]) {
      expect((await call).status).toBe(403);
    }
  });

  it('rejects malformed keys and keys Anthropic refuses, without storing them', async () => {
    const bad = await request(app).put('/api/agent/settings/customer-key').set(auth(admin)).send({ apiKey: 'hola' });
    expect(bad.status).toBe(400);

    setKeyValidator(async () => {
      throw apiError(401, 'invalid x-api-key');
    });
    const refused = await request(app).put('/api/agent/settings/customer-key').set(auth(admin)).send({ apiKey: CUSTOMER });
    expect(refused.status).toBe(400);

    setKeyValidator(async () => {
      throw new Error('ECONNRESET');
    });
    const offline = await request(app).put('/api/agent/settings/customer-key').set(auth(admin)).send({ apiKey: CUSTOMER });
    expect(offline.status).toBe(503);

    expect((await settings()).customerKey.configured).toBe(false);
  });

  it('stores the key encrypted and never returns it', async () => {
    await saveCustomerKey();
    const s = await settings();
    expect(s.customerKey).toMatchObject({ configured: true, last4: 'WXYZ', status: 'ok' });
    expect(JSON.stringify(s)).not.toContain(CUSTOMER);
    const raw = getDb().prepare("SELECT value FROM app_settings WHERE key = 'customer_key_enc'").get() as { value: string };
    expect(raw.value).not.toContain(CUSTOMER);
    expect(raw.value.startsWith('v1:')).toBe(true);

    const del = await request(app).delete('/api/agent/settings/customer-key').set(auth(admin));
    expect(del.status).toBe(204);
    expect((await settings()).customerKey.configured).toBe(false);
  });

  it('cannot be saved when the policy is provider_only', async () => {
    process.env.AGENT_KEY_POLICY = 'provider_only';
    setKeyValidator(async () => undefined);
    const r = await request(app).put('/api/agent/settings/customer-key').set(auth(admin)).send({ apiKey: CUSTOMER });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CUSTOMER_KEY_DISABLED');
  });
});

describe('which key pays', () => {
  it('default: provider key without a customer key; the customer key alone once saved', async () => {
    let seen = fakeByKey({ [PROVIDER]: 'ok', [CUSTOMER]: 'ok' });
    expect((await settings()).effectiveSource).toBe('provider');
    await chat(sales);
    expect(seen).toEqual([PROVIDER]);

    await saveCustomerKey();
    seen = fakeByKey({ [PROVIDER]: 'ok', [CUSTOMER]: 'ok' });
    expect((await settings()).effectiveSource).toBe('customer');
    await chat(sales);
    expect(seen).toEqual([CUSTOMER]);
    expect(usageRows().map((r) => [r.keySource, r.viaFallback])).toEqual([
      ['provider', 0],
      ['customer', 0],
    ]);
  });

  it('provider_only ignores any saved customer key', async () => {
    await saveCustomerKey();
    process.env.AGENT_KEY_POLICY = 'provider_only';
    const seen = fakeByKey({ [PROVIDER]: 'ok', [CUSTOMER]: 'ok' });
    await chat(sales);
    expect(seen).toEqual([PROVIDER]);
  });

  it('customer_only never touches the provider key', async () => {
    process.env.AGENT_KEY_POLICY = 'customer_only';
    const seen = fakeByKey({ [PROVIDER]: 'ok' });
    const r = await request(app).post('/api/agent/chat').set(auth(sales)).send({ message: 'hola' });
    expect(r.status).toBe(503);
    expect(r.body.error.message).toMatch(/Ajustes/);
    expect(seen).toEqual([]);
  });

  it('returns 503 when there is no key at all', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    fakeByKey({});
    const r = await request(app).post('/api/agent/chat').set(auth(sales)).send({ message: 'hola' });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('AGENT_NOT_CONFIGURED');
  });
});

describe('customer key without credit', () => {
  it('default policy: stops with a clear message and does NOT spend the provider key', async () => {
    await saveCustomerKey();
    const seen = fakeByKey({ [CUSTOMER]: CREDIT(), [PROVIDER]: 'ok' });
    const { events } = await chat(sales);
    expect(seen).toEqual([CUSTOMER]);
    expect(events[events.length - 1]).toMatchObject({ type: 'error', code: 'AGENT_KEY_EXHAUSTED' });
    expect(events[events.length - 1].message).toMatch(/recárgalo/i);
    expect(usageRows()).toEqual([]);
    expect((await settings()).customerKey.status).toBe('exhausted');
  });

  it('customer_then_provider: switches to the provider key, tells the user and logs it as fallback', async () => {
    await saveCustomerKey();
    process.env.AGENT_KEY_POLICY = 'customer_then_provider';
    const seen = fakeByKey({ [CUSTOMER]: CREDIT(), [PROVIDER]: 'ok' });
    const { events } = await chat(sales);
    expect(seen).toEqual([CUSTOMER, PROVIDER]);
    expect(events.find((e) => e.type === 'notice')).toMatchObject({ code: 'KEY_FALLBACK' });
    expect(events[events.length - 1].type).toBe('done');
    const rows = usageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ keySource: 'provider', viaFallback: 1 });
    expect(rows[0].costUsd).toBeCloseTo((100 * 4 + 20 * 20) / 1e6, 10);
    const s = await settings();
    expect(s.customerKey.status).toBe('exhausted');
    expect(s.fallback).toMatchObject({ enabled: true, capReached: false });
    expect(s.fallback.spentUsd).toBeGreaterThan(0);
  });

  it('customer_then_provider also falls back when the customer key is invalid', async () => {
    await saveCustomerKey();
    process.env.AGENT_KEY_POLICY = 'customer_then_provider';
    const seen = fakeByKey({ [CUSTOMER]: apiError(401, 'invalid x-api-key'), [PROVIDER]: 'ok' });
    await chat(sales);
    expect(seen).toEqual([CUSTOMER, PROVIDER]);
    expect((await settings()).customerKey.status).toBe('invalid');
  });

  it('does not fall back on transient errors like a rate limit', async () => {
    await saveCustomerKey();
    process.env.AGENT_KEY_POLICY = 'customer_then_provider';
    const seen = fakeByKey({ [CUSTOMER]: apiError(429, 'rate limited'), [PROVIDER]: 'ok' });
    const { events } = await chat(sales);
    expect(seen).toEqual([CUSTOMER]);
    expect(events[events.length - 1]).toMatchObject({ type: 'error', code: 'AGENT_RATE_LIMITED' });
    expect((await settings()).customerKey.status).toBe('ok');
  });

  it('stops at the monthly fallback cap and never calls the provider key', async () => {
    await saveCustomerKey();
    process.env.AGENT_KEY_POLICY = 'customer_then_provider';
    process.env.AGENT_FALLBACK_MONTHLY_CAP_USD = '0.5';
    getDb()
      .prepare(
        `INSERT INTO agent_usage (userId, conversationId, model, keySource, viaFallback, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, createdAt)
         VALUES (NULL, NULL, 'claude-opus-5-5', 'provider', 1, 1, 1, 0, 0, 0.6, ?)`,
      )
      .run(new Date().toISOString());
    const seen = fakeByKey({ [CUSTOMER]: CREDIT(), [PROVIDER]: 'ok' });
    const { events } = await chat(sales);
    expect(seen).toEqual([CUSTOMER]);
    expect(events[events.length - 1]).toMatchObject({ type: 'error', code: 'AGENT_FALLBACK_CAP' });
    expect((await settings()).fallback.capReached).toBe(true);
  });

  it('recovers: once the customer key works again its status goes back to ok', async () => {
    await saveCustomerKey();
    fakeByKey({ [CUSTOMER]: CREDIT() });
    await chat(sales);
    expect((await settings()).customerKey.status).toBe('exhausted');
    fakeByKey({ [CUSTOMER]: 'ok' });
    await chat(sales);
    expect((await settings()).customerKey.status).toBe('ok');
  });
});

describe('usage report', () => {
  it('adds up spend per key source and per user for billing', async () => {
    fakeByKey({ [PROVIDER]: 'ok', [CUSTOMER]: CREDIT() });
    await chat(sales);
    await chat(admin);
    await saveCustomerKey();
    process.env.AGENT_KEY_POLICY = 'customer_then_provider';
    await chat(sales); // customer exhausted → provider fallback

    const r = await request(app).get('/api/agent/usage').set(auth(admin));
    expect(r.status).toBe(200);
    expect(r.body.month).toMatch(/^\d{4}-\d{2}$/);
    const provider = r.body.totals.filter((t: { source: string }) => t.source === 'provider');
    expect(provider.find((t: { viaFallback: boolean }) => !t.viaFallback)).toMatchObject({ messages: 2 });
    expect(provider.find((t: { viaFallback: boolean }) => t.viaFallback)).toMatchObject({ messages: 1 });
    expect(r.body.byUser.length).toBeGreaterThanOrEqual(2);

    const other = await request(app).get('/api/agent/usage?month=2001-01').set(auth(admin));
    expect(other.body.totals).toEqual([]);
  });
});
