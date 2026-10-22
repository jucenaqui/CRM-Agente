import type Anthropic from '@anthropic-ai/sdk';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pendingConfirmations } from '../../src/agent/confirm';
import { setAgentLLM, type AgentLLM, type StreamParams } from '../../src/agent/llm';
import { SYSTEM_PROMPT } from '../../src/agent/loop';
import { app } from '../../src/app';

type Block = Anthropic.Beta.BetaContentBlock;

let seq = 0;
async function reg() {
  const r = await request(app)
    .post('/api/auth/register')
    .send({ name: `Conf ${++seq}`, email: `conf-${seq}@test.local`, password: 'Password123!' });
  return { token: r.body.token as string, id: r.body.user.id as number };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const toolUse = (id: string, name: string, input: unknown) =>
  ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } }) as unknown as Block;
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as Block;
const reply = (content: Block[], stop_reason: Anthropic.Beta.BetaMessage['stop_reason'] = 'end_turn') =>
  ({
    id: `msg_${++seq}`,
    type: 'message',
    role: 'assistant',
    model: 'fake',
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }) as unknown as Anthropic.Beta.BetaMessage;

function fakeLLM(replies: Anthropic.Beta.BetaMessage[]) {
  const calls: StreamParams[] = [];
  const llm: AgentLLM = {
    stream(params) {
      calls.push(structuredClone(params));
      const next = replies.shift();
      if (!next) throw new Error('no more scripted replies');
      return {
        on: () => undefined,
        finalMessage: async () => next,
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
function startChat(token: string, message: string): Promise<Ev[]> {
  return request(app)
    .post('/api/agent/chat')
    .set(auth(token))
    .send({ message })
    .buffer(true)
    .parse((r, cb) => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (d += c));
      r.on('end', () => cb(null, d));
    })
    .then((res) =>
      String(res.body)
        .split('\n\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => JSON.parse(l.slice(6)) as Ev),
    );
}

async function waitPending() {
  for (let i = 0; i < 200 && pendingConfirmations() === 0; i++) await new Promise((r) => setTimeout(r, 10));
  expect(pendingConfirmations()).toBe(1);
}

let owner: { token: string; id: number };
let other: { token: string; id: number };

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-provider-key-0123456789';
  await reg(); // first user is admin
  owner = await reg();
  other = await reg();
});
afterEach(() => {
  setAgentLLM(null);
  delete process.env.AGENT_CONFIRM_TIMEOUT_MS;
});

const makeCompany = async (name: string) =>
  (await request(app).post('/api/companies').set(auth(owner.token)).send({ name })).body.id as number;
const exists = async (id: number) => (await request(app).get(`/api/companies/${id}`).set(auth(owner.token))).status === 200;
const confirm = (token: string, callId: string, approve: boolean) =>
  request(app).post('/api/agent/chat/confirm').set(auth(token)).send({ callId, approve });

describe('delete confirmation', () => {
  it('asks first, and deletes only after the person approves', async () => {
    const id = await makeCompany('Borrar con permiso');
    const calls = fakeLLM([
      reply([toolUse('tu_del', 'delete_record', { entity: 'companies', id })], 'tool_use'),
      reply([text('Borrada.')]),
    ]);
    const chat = startChat(owner.token, 'Borra la empresa Borrar con permiso');
    await waitPending();
    expect(await exists(id)).toBe(true); // nothing deleted while waiting

    expect((await confirm(owner.token, 'tu_del', true)).status).toBe(204);
    const events = await chat;

    expect(await exists(id)).toBe(false);
    const req = events.find((e) => e.type === 'confirm_required');
    expect(req).toMatchObject({ callId: 'tu_del', label: expect.stringContaining('Borrar con permiso') });
    expect(req!.label).toContain(`id ${id}`);
    expect(events.find((e) => e.type === 'confirm_resolved')).toMatchObject({ decision: 'approved' });
    expect(events.find((e) => e.type === 'tool_end')).toMatchObject({ ok: true, changed: 'companies' });
    expect(events[events.length - 1].type).toBe('done');
    const result = (calls[1].messages[calls[1].messages.length - 1].content as { is_error: boolean }[])[0];
    expect(result.is_error).toBe(false);
  });

  it('keeps the record when the person cancels, and tells the model', async () => {
    const id = await makeCompany('No borrar');
    const calls = fakeLLM([
      reply([toolUse('tu_no', 'delete_record', { entity: 'companies', id })], 'tool_use'),
      reply([text('De acuerdo, no la borro.')]),
    ]);
    const chat = startChat(owner.token, 'Borra No borrar');
    await waitPending();
    await confirm(owner.token, 'tu_no', false);
    const events = await chat;

    expect(await exists(id)).toBe(true);
    expect(events.find((e) => e.type === 'confirm_resolved')).toMatchObject({ decision: 'denied' });
    expect(events.find((e) => e.type === 'tool_end')).toMatchObject({ ok: false });
    const result = (calls[1].messages[calls[1].messages.length - 1].content as { is_error: boolean; content: string }[])[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('canceló');
  });

  it('counts silence as "no": nothing is deleted when the confirmation expires', async () => {
    process.env.AGENT_CONFIRM_TIMEOUT_MS = '60';
    const id = await makeCompany('Sin respuesta');
    fakeLLM([
      reply([toolUse('tu_exp', 'delete_record', { entity: 'companies', id })], 'tool_use'),
      reply([text('No me confirmaste.')]),
    ]);
    const events = await startChat(owner.token, 'Borra Sin respuesta');
    expect(events.find((e) => e.type === 'confirm_resolved')).toMatchObject({ decision: 'expired' });
    expect(await exists(id)).toBe(true);
    expect(pendingConfirmations()).toBe(0);
  });

  it('only the person who started the chat can answer; unknown calls are 404', async () => {
    const id = await makeCompany('Ajena');
    fakeLLM([
      reply([toolUse('tu_priv', 'delete_record', { entity: 'companies', id })], 'tool_use'),
      reply([text('ok')]),
    ]);
    const chat = startChat(owner.token, 'Borra Ajena');
    await waitPending();
    expect((await confirm(other.token, 'tu_priv', true)).status).toBe(404); // someone else cannot approve it
    expect(await exists(id)).toBe(true);
    expect((await confirm(owner.token, 'tu_inventada', true)).status).toBe(404);
    expect((await request(app).post('/api/agent/chat/confirm').set(auth(owner.token)).send({ callId: 'x' })).status).toBe(400);
    await confirm(owner.token, 'tu_priv', false);
    await chat;
  });

  it('does not ask when the record is not visible to the user (nothing to confirm, the delete just fails)', async () => {
    const id = await makeCompany('De otro usuario');
    const calls = fakeLLM([
      reply([toolUse('tu_hid', 'delete_record', { entity: 'companies', id })], 'tool_use'),
      reply([text('No pude.')]),
    ]);
    const events = await startChat(other.token, 'Borra esa empresa');
    expect(events.some((e) => e.type === 'confirm_required')).toBe(false);
    expect(events.find((e) => e.type === 'tool_end')).toMatchObject({ ok: false });
    expect(await exists(id)).toBe(true);
    const result = (calls[1].messages[calls[1].messages.length - 1].content as { content: string }[])[0];
    expect(JSON.parse(result.content).status).toBe(404);
  });

  it('asks once per delete when the model requests several, in order', async () => {
    const a = await makeCompany('Doble A');
    const b = await makeCompany('Doble B');
    fakeLLM([
      reply(
        [toolUse('tu_a', 'delete_record', { entity: 'companies', id: a }), toolUse('tu_b', 'delete_record', { entity: 'companies', id: b })],
        'tool_use',
      ),
      reply([text('Listo.')]),
    ]);
    const chat = startChat(owner.token, 'Borra Doble A y Doble B');
    await waitPending();
    await confirm(owner.token, 'tu_a', true);
    // the second prompt only appears after the first is answered
    for (let i = 0; i < 200 && pendingConfirmations() === 0; i++) await new Promise((r) => setTimeout(r, 10));
    await confirm(owner.token, 'tu_b', false);
    const events = await chat;
    expect(events.filter((e) => e.type === 'confirm_required').map((e) => e.callId)).toEqual(['tu_a', 'tu_b']);
    expect(await exists(a)).toBe(false);
    expect(await exists(b)).toBe(true);
  });

  it('other tools never need confirmation, and the prompt tells the model the CRM asks for it', async () => {
    const calls = fakeLLM([
      reply([toolUse('tu_c', 'create_company', { name: 'Sin confirmar' })], 'tool_use'),
      reply([text('Creada.')]),
    ]);
    const events = await startChat(owner.token, 'Crea Sin confirmar');
    expect(events.some((e) => e.type === 'confirm_required')).toBe(false);
    expect(events.find((e) => e.type === 'tool_end')).toMatchObject({ ok: true });
    expect(calls[0].system).toBe(SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT).toMatch(/pulsa «Borrar»/);
  });
});
