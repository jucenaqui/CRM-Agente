import type Anthropic from '@anthropic-ai/sdk';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setAgentLLM, type AgentLLM, type StreamParams } from '../../src/agent/llm';
import { SYSTEM_PROMPT } from '../../src/agent/loop';
import { AGENT_TOOLS } from '../../src/agent/tools';
import { app } from '../../src/app';

type Block = Anthropic.Beta.BetaContentBlock;

let seq = 0;
const reg = async (role: 'first' | 'other') => {
  const r = await request(app)
    .post('/api/auth/register')
    .send({ name: `Agente ${role} ${++seq}`, email: `agent-${role}-${seq}@test.local`, password: 'Password123!' });
  expect(r.status).toBe(201);
  return { token: r.body.token as string, user: r.body.user };
};
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const text = (t: string): Block => ({ type: 'text', text: t, citations: null }) as Block;
const toolUse = (id: string, name: string, input: unknown): Block =>
  ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } }) as unknown as Block;

function reply(content: Block[], stop_reason: Anthropic.Beta.BetaMessage['stop_reason'] = 'end_turn') {
  return {
    id: `msg_${++seq}`,
    type: 'message',
    role: 'assistant',
    model: 'fake',
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

/** Scripted Claude: returns the queued replies in order and records every request. */
function fakeLLM(replies: Anthropic.Beta.BetaMessage[]) {
  const calls: StreamParams[] = [];
  const llm: AgentLLM = {
    stream(params) {
      calls.push(structuredClone(params));
      const next = replies.shift();
      if (!next) throw new Error('fake LLM: no more scripted replies');
      const listeners: ((d: string) => void)[] = [];
      return {
        on(_event, listener) {
          listeners.push(listener);
          return this;
        },
        async finalMessage() {
          for (const b of next.content) if (b.type === 'text') listeners.forEach((l) => l(b.text));
          return next;
        },
      };
    },
  };
  setAgentLLM(llm);
  return calls;
}

interface Ev {
  type: string;
  [k: string]: unknown;
}

async function chat(token: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post('/api/agent/chat')
    .set(auth(token))
    .send(body)
    .buffer(true)
    .parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (data += c));
      r.on('end', () => cb(null, data));
    });
  const raw = typeof res.body === 'string' ? res.body : '';
  const events: Ev[] = raw
    .split('\n\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)));
  return { res, events };
}

let admin: { token: string; user: { id: number } };
let alice: { token: string; user: { id: number } };
let bob: { token: string; user: { id: number } };

beforeAll(async () => {
  admin = await reg('first'); // first registered user becomes admin
  alice = await reg('other');
  bob = await reg('other');
});

afterEach(() => {
  setAgentLLM(null);
  delete process.env.AGENT_MODELS;
  delete process.env.AGENT_DEFAULT_MODEL;
});

describe('agent: models', () => {
  it('lists the selectable models with Opus 5.5 as default', async () => {
    fakeLLM([]);
    const r = await request(app).get('/api/agent/models').set(auth(alice.token));
    expect(r.status).toBe(200);
    expect(r.body.configured).toBe(true);
    expect(r.body.defaultModel).toBe('claude-opus-5-5');
    expect(r.body.models.map((m: { id: string }) => m.id)).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-fable-5-1',
    ]);
  });

  it('respects AGENT_MODELS / AGENT_DEFAULT_MODEL set by the deployment', async () => {
    fakeLLM([]);
    process.env.AGENT_MODELS = 'claude-sonnet-5-5,claude-haiku-5-5,not-a-model';
    process.env.AGENT_DEFAULT_MODEL = 'claude-haiku-5-5';
    const r = await request(app).get('/api/agent/models').set(auth(alice.token));
    expect(r.body.models.map((m: { id: string }) => m.id)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(r.body.defaultModel).toBe('claude-haiku-5-5');
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/agent/models')).status).toBe(401);
  });
});

describe('agent: chat', () => {
  it('returns 503 when no Anthropic credentials are configured', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const r = await request(app).post('/api/agent/chat').set(auth(alice.token)).send({ message: 'hola' });
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('AGENT_NOT_CONFIGURED');
  });

  it('rejects a model that is not enabled', async () => {
    fakeLLM([]);
    process.env.AGENT_MODELS = 'claude-haiku-5-5';
    const r = await request(app)
      .post('/api/agent/chat')
      .set(auth(alice.token))
      .send({ message: 'hola', model: 'claude-opus-5-5' });
    expect(r.status).toBe(400);
    expect(r.body.error.details.allowed).toEqual(['claude-haiku-5-5']);
  });

  it('runs CRM tools as the user and persists an append-only history', async () => {
    const calls = fakeLLM([
      reply([text('Creo la empresa.'), toolUse('tu_1', 'create_company', { name: 'Acme Agente', website: 'acme.io' })], 'tool_use'),
      reply([text('Listo: creé Acme Agente.')]),
      reply([toolUse('tu_2', 'list_records', { entity: 'companies', search: 'Acme Agente' })], 'tool_use'),
      reply([text('Tienes 1 empresa llamada Acme Agente.')]),
    ]);

    const first = await chat(alice.token, { message: 'Crea la empresa Acme Agente' });
    expect(first.res.status).toBe(200);
    expect(first.res.headers['content-type']).toMatch(/text\/event-stream/);
    const types = first.events.map((e) => e.type);
    expect(types[0]).toBe('conversation');
    expect(types).toContain('tool_start');
    expect(types[types.length - 1]).toBe('done');
    const end = first.events.find((e) => e.type === 'tool_end')!;
    expect(end).toMatchObject({ ok: true, changed: 'companies' });
    const conversationId = first.events[0].id as number;

    // Created through the real API, owned by Alice, website normalized by the API.
    const list = await request(app).get('/api/companies?search=Acme%20Agente').set(auth(alice.token));
    expect(list.body.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({ ownerId: alice.user.id, website: 'https://acme.io' });

    // Request shape the four models share.
    expect(calls[0]).toMatchObject({
      model: 'claude-opus-5-5',
      system: SYSTEM_PROMPT,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(calls[0]).not.toHaveProperty('thinking');
    expect(calls[0]).not.toHaveProperty('tool_choice');
    expect(calls[0]).not.toHaveProperty('temperature');
    // Second step carries the tool result back.
    const lastMsg = calls[1].messages[calls[1].messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect((lastMsg.content as { type: string; is_error: boolean }[])[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tu_1',
      is_error: false,
    });

    // Second turn: history is replayed unchanged as a prefix (append-only).
    await chat(alice.token, { message: '¿Cuántas Acme tengo?', conversationId });
    expect(calls[2].messages.slice(0, calls[1].messages.length + 1)).toEqual([
      ...calls[1].messages,
      { role: 'assistant', content: [text('Listo: creé Acme Agente.')] },
    ]);
    expect(calls[2].tools).toEqual(calls[0].tools);
    expect(calls[2].system).toBe(calls[0].system);

    // Transcript for the UI hides the context block.
    const t = await request(app).get(`/api/agent/conversations/${conversationId}`).set(auth(alice.token));
    expect(t.status).toBe(200);
    expect(t.body.items[0]).toEqual({ kind: 'user', text: 'Crea la empresa Acme Agente' });
    expect(t.body.items).toContainEqual(
      expect.objectContaining({ kind: 'tool', name: 'create_company', ok: true }),
    );
    expect(JSON.stringify(t.body.items)).not.toContain('<contexto>');
  });

  it('uses the model chosen by the client, with fallbacks only where supported', async () => {
    const calls = fakeLLM([reply([text('hola')]), reply([text('hola')]), reply([text('hola')])]);
    await chat(alice.token, { message: 'hola', model: 'claude-sonnet-5-5' });
    await chat(alice.token, { message: 'hola', model: 'claude-haiku-5-5' });
    const fable = await chat(alice.token, { message: 'hola', model: 'claude-fable-5-1' });
    expect(calls[0]).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default' });
    expect(calls[1].model).toBe('claude-haiku-5-5');
    expect(calls[1]).not.toHaveProperty('fallbacks');
    expect(calls[1]).not.toHaveProperty('betas');
    expect(calls[2]).toMatchObject({ model: 'claude-fable-5-1', fallbacks: 'default' });
    const done = fable.events.find((e) => e.type === 'done') as { usage: { estimatedCostUsd: number } };
    expect(done.usage.estimatedCostUsd).toBeCloseTo((100 * 10 + 20 * 50) / 1e6, 8);
  });

  it('lets the client switch model mid-conversation and keeps the conversation', async () => {
    const calls = fakeLLM([reply([text('uno')]), reply([text('dos')])]);
    const first = await chat(alice.token, { message: 'uno', model: 'claude-haiku-5-5' });
    const id = first.events[0].id as number;
    await chat(alice.token, { message: 'dos', model: 'claude-opus-5-5', conversationId: id });
    expect(calls[1].model).toBe('claude-opus-5-5');
    expect(calls[1].messages.length).toBe(3);
    const conv = await request(app).get(`/api/agent/conversations/${id}`).set(auth(alice.token));
    expect(conv.body.model).toBe('claude-opus-5-5');
  });

  it('cannot read or change another user’s records through tools', async () => {
    const own = await request(app).post('/api/companies').set(auth(alice.token)).send({ name: 'Secreta de Alice' });
    const companyId = own.body.id as number;
    const calls = fakeLLM([
      reply(
        [
          toolUse('t1', 'get_record', { entity: 'companies', id: companyId }),
          toolUse('t2', 'update_company', { id: companyId, name: 'Hackeada' }),
          toolUse('t3', 'delete_record', { entity: 'companies', id: companyId }),
          toolUse('t4', 'list_records', { entity: 'users' }),
        ],
        'tool_use',
      ),
      reply([text('No tengo acceso.')]),
    ]);
    const { events } = await chat(bob.token, { message: 'Borra la empresa de Alice' });
    const ends = events.filter((e) => e.type === 'tool_end');
    expect(ends.map((e) => e.ok)).toEqual([false, false, false, false]);
    const results = calls[1].messages[calls[1].messages.length - 1].content as { content: string }[];
    expect(JSON.parse(results[0].content).status).toBe(404);
    expect(JSON.parse(results[3].content).status).toBe(403); // users is admin-only

    const still = await request(app).get(`/api/companies/${companyId}`).set(auth(alice.token));
    expect(still.status).toBe(200);
    expect(still.body.name).toBe('Secreta de Alice');
  });

  it('lets an admin manage users through tools', async () => {
    fakeLLM([
      reply(
        [toolUse('u1', 'create_user', { name: 'Nueva', email: 'nueva-agente@test.local', password: 'Password123!', role: 'sales' })],
        'tool_use',
      ),
      reply([text('Usuario creado.')]),
    ]);
    const { events } = await chat(admin.token, { message: 'Crea la usuaria Nueva' });
    expect(events.find((e) => e.type === 'tool_end')).toMatchObject({ ok: true, changed: 'users' });
    const users = await request(app).get('/api/users?search=nueva-agente').set(auth(admin.token));
    expect(users.body.total).toBe(1);
  });

  it('reports invalid tool input back to the model instead of running it', async () => {
    const calls = fakeLLM([
      reply([toolUse('x1', 'get_record', { entity: 'companies', id: -3 }), toolUse('x2', 'nope', {})], 'tool_use'),
      reply([text('Perdón.')]),
    ]);
    await chat(alice.token, { message: 'algo' });
    const results = calls[1].messages[calls[1].messages.length - 1].content as { is_error: boolean }[];
    expect(results.map((r) => r.is_error)).toEqual([true, true]);
  });

  it('stops on a refusal without storing a partial answer', async () => {
    fakeLLM([reply([], 'refusal')]);
    const { events } = await chat(alice.token, { message: 'algo prohibido' });
    expect(events[events.length - 1]).toMatchObject({ type: 'error', code: 'AGENT_REFUSAL' });
    const id = events[0].id as number;
    const conv = await request(app).get(`/api/agent/conversations/${id}`).set(auth(alice.token));
    expect(conv.body.items).toEqual([]);
  });

  it('never runs tool calls from a truncated (max_tokens) turn', async () => {
    fakeLLM([reply([toolUse('m1', 'delete_record', { entity: 'companies', id: 1 })], 'max_tokens')]);
    const { events } = await chat(alice.token, { message: 'borra' });
    expect(events.some((e) => e.type === 'tool_start')).toBe(false);
    expect(events[events.length - 1]).toMatchObject({ type: 'error', code: 'AGENT_TRUNCATED' });
  });
});

describe('agent: conversations', () => {
  it('are private to their owner and can be deleted', async () => {
    fakeLLM([reply([text('hola')])]);
    const { events } = await chat(alice.token, { message: 'hola privada' });
    const id = events[0].id as number;

    expect((await request(app).get(`/api/agent/conversations/${id}`).set(auth(bob.token))).status).toBe(404);
    const bobList = await request(app).get('/api/agent/conversations').set(auth(bob.token));
    expect(bobList.body.data.some((c: { id: number }) => c.id === id)).toBe(false);
    const bobChat = await request(app)
      .post('/api/agent/chat')
      .set(auth(bob.token))
      .send({ message: 'x', conversationId: id });
    expect(bobChat.status).toBe(404);

    expect((await request(app).delete(`/api/agent/conversations/${id}`).set(auth(alice.token))).status).toBe(204);
    expect((await request(app).get(`/api/agent/conversations/${id}`).set(auth(alice.token))).status).toBe(404);
  });

  it('tool definitions are valid and stable', () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of AGENT_TOOLS) {
      expect(t.name).toMatch(/^[a-z_]{1,64}$/);
      expect(t.input_schema.type).toBe('object');
      expect(t.eager_input_streaming).toBe(true);
    }
  });
});
