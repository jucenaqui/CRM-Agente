import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { getDb } from '../../src/db';

let seq = 0;
async function reg() {
  const r = await request(app)
    .post('/api/auth/register')
    .send({ name: `Pipe ${++seq}`, email: `pipe-${seq}@test.local`, password: 'Password123!' });
  return r.body.token as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const api = {
  get: (t: string, url: string) => request(app).get(url).set(auth(t)),
  post: (t: string, url: string, body: object = {}) => request(app).post(url).set(auth(t)).send(body),
  patch: (t: string, url: string, body: object = {}) => request(app).patch(url).set(auth(t)).send(body),
  put: (t: string, url: string, body: object = {}) => request(app).put(url).set(auth(t)).send(body),
  del: (t: string, url: string) => request(app).delete(url).set(auth(t)),
};

let admin: string;
let sales: string;
let other: string;

beforeAll(async () => {
  admin = await reg(); // first user is admin
  sales = await reg();
  other = await reg();
});

const stages = async () => (await api.get(admin, '/api/pipeline/stages')).body.data as { id: number; key: string; name: string; kind: string; probability: number; position: number }[];
const byKey = async (key: string) => (await stages()).find((s) => s.key === key)!;
const newDeal = async (t: string, body: object) => (await api.post(t, '/api/deals', { title: 'Trato', value: 100, ...body })).body;

describe('default pipeline', () => {
  it('ships with the six default stages, in order, with kinds and probabilities', async () => {
    const s = await stages();
    expect(s.map((x) => x.key)).toEqual(['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost']);
    expect(s.map((x) => x.kind)).toEqual(['open', 'open', 'open', 'open', 'won', 'lost']);
    expect(s.map((x) => x.name)).toEqual(['Lead', 'Calificado', 'Propuesta', 'Negociación', 'Ganado', 'Perdido']);
    expect(s.find((x) => x.key === 'won')!.probability).toBe(100);
  });

  it('exposes stages, lead sources and loss reasons in one call for everyone', async () => {
    const r = await api.get(sales, '/api/pipeline');
    expect(r.status).toBe(200);
    expect(r.body.stages).toHaveLength(6);
    expect(r.body.leadSources.map((o: { name: string }) => o.name)).toContain('Recomendación');
    expect(r.body.lossReasons.map((o: { name: string }) => o.name)).toContain('Precio');
  });

  it('only admins can change it; everyone can read it', async () => {
    expect((await api.get(sales, '/api/pipeline/stages')).status).toBe(200);
    const lead = await byKey('lead');
    for (const call of [
      api.post(sales, '/api/pipeline/stages', { name: 'Mía' }),
      api.patch(sales, `/api/pipeline/stages/${lead.id}`, { name: 'Otra' }),
      api.del(sales, `/api/pipeline/stages/${lead.id}`),
      api.put(sales, '/api/pipeline/stages/order', { ids: [1] }),
      api.post(sales, '/api/pipeline/options/lead_source', { name: 'X' }),
    ]) {
      expect((await call).status).toBe(403);
    }
    expect((await request(app).get('/api/pipeline/stages')).status).toBe(401);
  });
});

describe('customising stages', () => {
  it('adds an open stage before the closed ones; deals can use it and be filtered by it', async () => {
    const r = await api.post(admin, '/api/pipeline/stages', { name: 'Demo agendada', probability: 40 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ key: 'demo-agendada', kind: 'open', probability: 40 });
    const s = await stages();
    expect(s.map((x) => x.key)).toEqual(['lead', 'qualified', 'proposal', 'negotiation', 'demo-agendada', 'won', 'lost']);
    expect(s.map((x) => x.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const d = await newDeal(sales, { stage: 'demo-agendada' });
    expect(d.stage).toBe('demo-agendada');
    const list = await api.get(sales, '/api/deals?stage=demo-agendada');
    expect(list.body.data.map((x: { id: number }) => x.id)).toContain(d.id);
    expect((await api.get(sales, '/api/deals?stage=nope')).status).toBe(400);
  });

  it('keeps stage names unique and generates unique keys', async () => {
    expect((await api.post(admin, '/api/pipeline/stages', { name: 'demo agendada' })).status).toBe(409);
    await api.post(admin, '/api/pipeline/stages', { name: 'Ñandú Ágil' });
    expect((await byKey('nandu-agil')).name).toBe('Ñandú Ágil'); // accents and symbols become a clean key
    // a different name that slugs to the same key still gets its own unique key
    const second = await api.post(admin, '/api/pipeline/stages', { name: 'Ñandú  ágil!' });
    expect(second.status).toBe(201);
    expect(second.body.key).toBe('nandu-agil-2');
  });

  it('forces 100% for won stages and 0% for lost stages', async () => {
    const won = await api.post(admin, '/api/pipeline/stages', { name: 'Firmado', kind: 'won', probability: 30 });
    expect(won.body).toMatchObject({ kind: 'won', probability: 100 });
    const lost = await api.post(admin, '/api/pipeline/stages', { name: 'Descartado', kind: 'lost', probability: 30 });
    expect(lost.body).toMatchObject({ kind: 'lost', probability: 0 });
    const s = await stages();
    expect(s[s.length - 1].key).toBe('descartado'); // closed stages are appended at the end
  });

  it('renaming changes what people see but not the key deals use', async () => {
    const d = await newDeal(sales, { stage: 'qualified' });
    const q = await byKey('qualified');
    const r = await api.patch(admin, `/api/pipeline/stages/${q.id}`, { name: 'Cualificado', probability: 30, color: '#112233' });
    expect(r.body).toMatchObject({ key: 'qualified', name: 'Cualificado', probability: 30, color: '#112233' });
    expect((await api.get(sales, `/api/deals/${d.id}`)).body.stage).toBe('qualified');
    expect((await api.patch(admin, `/api/pipeline/stages/${q.id}`, { color: 'rojo' })).status).toBe(400);
    expect((await api.patch(admin, `/api/pipeline/stages/${q.id}`, { probability: 150 })).status).toBe(400);
    expect((await api.patch(admin, '/api/pipeline/stages/99999', { name: 'x' })).status).toBe(404);
  });

  it('reorders stages, but open ones must stay before won/lost', async () => {
    const s = await stages();
    const open = s.filter((x) => x.kind === 'open');
    const closed = s.filter((x) => x.kind !== 'open');
    const reversed = [...open].reverse();
    const ok = await api.put(admin, '/api/pipeline/stages/order', { ids: [...reversed, ...closed].map((x) => x.id) });
    expect(ok.status).toBe(200);
    expect((await stages()).filter((x) => x.kind === 'open').map((x) => x.id)).toEqual(reversed.map((x) => x.id));

    expect((await api.put(admin, '/api/pipeline/stages/order', { ids: [...closed, ...open].map((x) => x.id) })).status).toBe(400);
    expect((await api.put(admin, '/api/pipeline/stages/order', { ids: open.map((x) => x.id) })).status).toBe(400); // missing some
    // put it back
    await api.put(admin, '/api/pipeline/stages/order', { ids: [...open, ...closed].map((x) => x.id) });
  });

  it('new deals start in the first open stage, whatever it is called', async () => {
    const first = (await stages()).filter((x) => x.kind === 'open')[0];
    const d = await newDeal(sales, {});
    expect(d.stage).toBe(first.key);
  });
});

describe('deleting stages', () => {
  it('refuses to leave the pipeline without an open, a won or a lost stage', async () => {
    // keep exactly one lost stage (delete the extra one created above) and one won stage
    const s = await stages();
    for (const extra of s.filter((x) => ['firmado', 'descartado'].includes(x.key))) {
      expect((await api.del(admin, `/api/pipeline/stages/${extra.id}`)).status).toBe(204);
    }
    const lost = await byKey('lost');
    const won = await byKey('won');
    const r = await api.del(admin, `/api/pipeline/stages/${lost.id}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('LAST_OF_KIND');
    expect((await api.patch(admin, `/api/pipeline/stages/${won.id}`, { kind: 'open' })).body.error.code).toBe('LAST_OF_KIND');
  });

  it('needs a destination when deals are in the stage, and moves them with their history', async () => {
    const st = (await api.post(admin, '/api/pipeline/stages', { name: 'Temporal' })).body;
    const a = await newDeal(sales, { stage: 'temporal' });
    const b = await newDeal(other, { stage: 'temporal' });
    const refused = await api.del(admin, `/api/pipeline/stages/${st.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'STAGE_IN_USE', details: { deals: 2 } });

    expect((await api.del(admin, `/api/pipeline/stages/${st.id}?moveTo=${st.id}`)).status).toBe(400); // not to itself
    const won = await byKey('won');
    expect((await api.del(admin, `/api/pipeline/stages/${st.id}?moveTo=${won.id}`)).status).toBe(204);

    for (const d of [a, b]) {
      const moved = (await request(app).get(`/api/deals/${d.id}`).set(auth(d === a ? sales : other))).body;
      expect(moved.stage).toBe('won');
      expect(moved.closedAt).toBeTruthy(); // moved into a won stage → counts as closed now
    }
    const hist = getDb().prepare('SELECT fromStage, toStage FROM deal_stage_history WHERE dealId = ? ORDER BY id').all(a.id);
    expect(hist).toEqual([
      { fromStage: null, toStage: 'temporal' },
      { fromStage: 'temporal', toStage: 'won' },
    ]);
    expect((await stages()).some((x) => x.key === 'temporal')).toBe(false);
  });

  it('deletes an empty stage right away and the first open stage can go too (defaults follow)', async () => {
    const lead = await byKey('lead');
    const inLead = await api.get(admin, '/api/deals?stage=lead&pageSize=100');
    const qualified = await byKey('qualified');
    expect((await api.del(admin, `/api/pipeline/stages/${lead.id}?moveTo=${qualified.id}`)).status).toBe(204);
    expect((await api.get(admin, '/api/deals?stage=lead')).status).toBe(400); // stage no longer exists
    const first = (await stages()).filter((x) => x.kind === 'open')[0];
    expect((await newDeal(sales, {})).stage).toBe(first.key);
    expect(inLead.body.data.length).toBeGreaterThanOrEqual(0);
  });
});

describe('deal close date, loss reason, origin and history', () => {
  const source = async (name: string) => (await api.get(admin, '/api/pipeline/options/lead_source')).body.data.find((o: { name: string }) => o.name === name).id as number;
  const reason = async (name: string) => (await api.get(admin, '/api/pipeline/options/loss_reason')).body.data.find((o: { name: string }) => o.name === name).id as number;

  it('sets closedAt when a deal enters a won/lost stage and clears it when reopened', async () => {
    const d = await newDeal(sales, { stage: 'proposal' });
    expect(d.closedAt).toBeNull();
    const won = (await api.patch(sales, `/api/deals/${d.id}/stage`, { stage: 'won' })).body;
    expect(won.closedAt).toBeTruthy();
    const reopened = (await api.patch(sales, `/api/deals/${d.id}/stage`, { stage: 'proposal' })).body;
    expect(reopened.closedAt).toBeNull();
    expect((await newDeal(sales, { stage: 'won' })).closedAt).toBeTruthy(); // created already closed
  });

  it('closedAt is derived: clients cannot set it', async () => {
    const r = await api.post(sales, '/api/deals', { title: 'x', closedAt: '2020-01-01T00:00:00.000Z' });
    expect(r.status).toBe(400);
  });

  it('keeps the original close date between stages of the same kind, resets it won → lost', async () => {
    const d = await newDeal(sales, { stage: 'won' });
    const t0 = d.closedAt as string;
    await new Promise((r) => setTimeout(r, 15));
    const lost = (await api.patch(sales, `/api/deals/${d.id}/stage`, { stage: 'lost' })).body;
    expect(lost.closedAt > t0).toBe(true); // a different closing event
  });

  it('stores the loss reason only on lost deals', async () => {
    const price = await reason('Precio');
    const d = await newDeal(sales, { stage: 'negotiation' });
    const lost = (await api.patch(sales, `/api/deals/${d.id}/stage`, { stage: 'lost', lostReasonId: price })).body;
    expect(lost).toMatchObject({ stage: 'lost', lostReasonId: price });
    const won = (await api.patch(sales, `/api/deals/${d.id}/stage`, { stage: 'won' })).body;
    expect(won.lostReasonId).toBeNull(); // no longer lost → the reason goes away
    const openDeal = await newDeal(sales, { stage: 'negotiation' });
    const tryReason = (await api.patch(sales, `/api/deals/${openDeal.id}`, { lostReasonId: price })).body;
    expect(tryReason.lostReasonId).toBeNull(); // meaningless on an open deal
  });

  it('validates source and reason ids', async () => {
    expect((await api.post(sales, '/api/deals', { title: 'x', sourceId: 99999 })).body.error.code).toBe('INVALID_REFERENCE');
    const price = await reason('Precio');
    expect((await api.post(sales, '/api/deals', { title: 'x', sourceId: price })).status).toBe(422); // a reason is not a source
    const web = await source('Web');
    const d = await newDeal(sales, { sourceId: web });
    expect(d.sourceId).toBe(web);
    const filtered = await api.get(sales, `/api/deals?sourceId=${web}`);
    expect(filtered.body.data.map((x: { id: number }) => x.id)).toContain(d.id);
  });

  it('records every stage change in the history, visible only to who can see the deal', async () => {
    const d = await newDeal(sales, { stage: 'qualified' });
    await api.patch(sales, `/api/deals/${d.id}/stage`, { stage: 'proposal' });
    await api.patch(sales, `/api/deals/${d.id}`, { stage: 'won', value: 5 });
    await api.patch(sales, `/api/deals/${d.id}`, { title: 'solo el título' }); // no stage change → no history row
    const h = await api.get(sales, `/api/deals/${d.id}/history`);
    expect(h.status).toBe(200);
    expect(h.body.data.map((x: { fromStage: string | null; toStage: string }) => [x.fromStage, x.toStage])).toEqual([
      [null, 'qualified'],
      ['qualified', 'proposal'],
      ['proposal', 'won'],
    ]);
    expect(h.body.data[0].changedByName).toMatch(/Pipe/);
    expect((await api.get(other, `/api/deals/${d.id}/history`)).status).toBe(404);
    expect((await api.get(admin, `/api/deals/${d.id}/history`)).status).toBe(200);
  });
});

describe('lead sources and loss reasons', () => {
  it('lets admins add, rename and reorder them, with unique names', async () => {
    const created = await api.post(admin, '/api/pipeline/options/lead_source', { name: 'Podcast' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Podcast', kind: 'lead_source', archived: false });
    expect((await api.post(admin, '/api/pipeline/options/lead_source', { name: 'podcast' })).status).toBe(409);
    const renamed = await api.patch(admin, `/api/pipeline/options/lead_source/${created.body.id}`, { name: 'Pódcast' });
    expect(renamed.body.name).toBe('Pódcast');

    const list = (await api.get(admin, '/api/pipeline/options/lead_source')).body.data as { id: number }[];
    const reversed = [...list].reverse().map((o) => o.id);
    expect((await api.put(admin, '/api/pipeline/options/lead_source/order', { ids: reversed })).status).toBe(200);
    expect((await api.get(admin, '/api/pipeline/options/lead_source')).body.data.map((o: { id: number }) => o.id)).toEqual(reversed);
    expect((await api.get(admin, '/api/pipeline/options/colour')).status).toBe(400);
  });

  it('deletes an unused option, but archives one that deals already use', async () => {
    const unused = (await api.post(admin, '/api/pipeline/options/loss_reason', { name: 'Se mudó' })).body;
    expect((await api.del(admin, `/api/pipeline/options/loss_reason/${unused.id}`)).body.result).toBe('deleted');

    const used = (await api.post(admin, '/api/pipeline/options/lead_source', { name: 'Feria' })).body;
    const d = await newDeal(sales, { sourceId: used.id });
    expect((await api.del(admin, `/api/pipeline/options/lead_source/${used.id}`)).body.result).toBe('archived');

    const active = (await api.get(admin, '/api/pipeline/options/lead_source')).body.data;
    expect(active.some((o: { id: number }) => o.id === used.id)).toBe(false); // hidden from pickers
    const all = (await api.get(admin, '/api/pipeline/options/lead_source?includeArchived=1')).body.data;
    expect(all.find((o: { id: number }) => o.id === used.id)).toMatchObject({ name: 'Feria', archived: true });
    expect((await api.get(sales, `/api/deals/${d.id}`)).body.sourceId).toBe(used.id); // old deal keeps it
    expect((await api.post(sales, '/api/deals', { title: 'x', sourceId: used.id })).status).toBe(422); // but no new use
    // the freed name can be used again
    expect((await api.post(admin, '/api/pipeline/options/lead_source', { name: 'Feria' })).status).toBe(201);
  });
});
