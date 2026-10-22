import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeTool } from '../../src/agent/tools';
import { app } from '../../src/app';
import { getDb } from '../../src/db';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

let seq = 0;
async function reg() {
  const r = await request(app)
    .post('/api/auth/register')
    .send({ name: `Met ${++seq}`, email: `met-${seq}@test.local`, password: 'Password123!' });
  return { token: r.body.token as string, id: r.body.user.id as number };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const get = (t: string, url: string) => request(app).get(url).set(auth(t));
const metrics = async (t: string, qs = '') => (await get(t, `/api/dashboard/metrics${qs}`)).body;

let admin: { token: string; id: number };
let s1: { token: string; id: number };
let s2: { token: string; id: number };

const optionId = async (kind: string, name: string) =>
  ((await get(admin.token, `/api/pipeline/options/${kind}`)).body.data as { id: number; name: string }[]).find((o) => o.name === name)!.id;

/**
 * Creates a deal and rewrites its dates/history so the scenario is exact:
 * `path` is the list of [stage, days ago it was entered]; the last one is the current stage.
 */
async function deal(owner: { token: string; id: number }, title: string, value: number, path: [string, number][], extra: { closedDaysAgo?: number; sourceId?: number | null; lostReasonId?: number | null; expected?: string | null } = {}) {
  const r = await request(app).post('/api/deals').set(auth(owner.token)).send({ title, value });
  const id = r.body.id as number;
  const db = getDb();
  const current = path[path.length - 1][0];
  db.prepare('UPDATE deals SET createdAt = ?, updatedAt = ?, stage = ?, closedAt = ?, sourceId = ?, lostReasonId = ?, expectedCloseDate = ? WHERE id = ?').run(
    iso(path[0][1]),
    iso(path[path.length - 1][1]),
    current,
    extra.closedDaysAgo === undefined ? null : iso(extra.closedDaysAgo),
    extra.sourceId ?? null,
    extra.lostReasonId ?? null,
    extra.expected ?? null,
    id,
  );
  db.prepare('DELETE FROM deal_stage_history WHERE dealId = ?').run(id);
  path.forEach(([stage, days], i) =>
    db.prepare('INSERT INTO deal_stage_history (dealId, fromStage, toStage, changedAt, changedBy) VALUES (?, ?, ?, ?, ?)').run(id, i === 0 ? null : path[i - 1][0], stage, iso(days), owner.id),
  );
  return id;
}

beforeAll(async () => {
  admin = await reg();
  s1 = await reg();
  s2 = await reg();
  const web = await optionId('lead_source', 'Web');
  const referral = await optionId('lead_source', 'Recomendación');
  const price = await optionId('loss_reason', 'Precio');

  // A: won 1000, 30-day cycle          B: won 3000, 10-day cycle (skipped "qualified")
  await deal(s1, 'A', 1000, [['lead', 40], ['qualified', 30], ['proposal', 20], ['won', 10]], { closedDaysAgo: 10, sourceId: web });
  await deal(s1, 'B', 3000, [['lead', 15], ['proposal', 10], ['won', 5]], { closedDaysAgo: 5, sourceId: referral });
  // C: lost 2000 (price)               D: lost 500 (no reason, straight from lead)
  await deal(s1, 'C', 2000, [['lead', 20], ['qualified', 12], ['lost', 3]], { closedDaysAgo: 3, sourceId: web, lostReasonId: price });
  await deal(s1, 'D', 500, [['lead', 9], ['lost', 8]], { closedDaysAgo: 8 });
  // open: E proposal 4000 (50%), F negotiation 2000 (75%, expected today), G lead 1000 (10%, stalled 60 days, overdue)
  await deal(s1, 'E', 4000, [['lead', 6], ['proposal', 2]]);
  await deal(s1, 'F', 2000, [['lead', 3], ['negotiation', 1]], { expected: iso(0) });
  await deal(s1, 'G', 1000, [['lead', 60]], { expected: iso(40) });

  // activities: one done (call), one overdue
  await request(app).post('/api/activities').set(auth(s1.token)).send({ type: 'call', subject: 'hecha', completed: true });
  await request(app).post('/api/activities').set(auth(s1.token)).send({ type: 'task', subject: 'vencida', dueDate: iso(1) });
});

describe('summary', () => {
  it('computes won/lost, win rate, average deal size and sales cycle from closed deals', async () => {
    const m = await metrics(s1.token, '?period=all');
    expect(m.summary).toMatchObject({
      wonCount: 2,
      wonValue: 4000,
      lostCount: 2,
      lostValue: 2500,
      winRate: 50,
      avgDealSize: 2000,
      avgCycleDays: 20, // A took 30 days, B took 10
      openCount: 3,
      openValue: 7000,
    });
  });

  it('only counts deals closed inside the period', async () => {
    getDb().prepare('UPDATE deals SET closedAt = ? WHERE title = ?').run(iso(100), 'A'); // A moves out of the 90d window
    const ninety = await metrics(s1.token, '?period=90d');
    expect(ninety.summary).toMatchObject({ wonCount: 1, wonValue: 3000, winRate: 33.3 }); // 1 won vs 2 lost
    const year = await metrics(s1.token, '?period=12m');
    expect(year.summary.wonCount).toBe(2);
    getDb().prepare('UPDATE deals SET closedAt = ? WHERE title = ?').run(iso(10), 'A');
  });

  it('rejects an unknown period', async () => {
    expect((await get(s1.token, '/api/dashboard/metrics?period=week')).status).toBe(400);
    expect((await request(app).get('/api/dashboard/metrics')).status).toBe(401);
  });
});

describe('forecast', () => {
  it('weights each open deal by the probability of its stage', async () => {
    const f = (await metrics(s1.token, '?period=all')).forecast;
    // G 1000×10% + E 4000×50% + F 2000×75%
    expect(f.weighted).toBe(3600);
    const stage = (k: string) => f.byStage.find((s: { stage: string }) => s.stage === k);
    expect(stage('lead')).toMatchObject({ name: 'Lead', probability: 10, count: 1, value: 1000, weighted: 100 });
    expect(stage('proposal')).toMatchObject({ count: 1, value: 4000, weighted: 2000 });
    expect(stage('negotiation')).toMatchObject({ count: 1, value: 2000, weighted: 1500 });
    expect(stage('qualified')).toMatchObject({ count: 0, weighted: 0 });
  });

  it('separates what is expected this month and what is already overdue', async () => {
    const f = (await metrics(s1.token, '?period=all')).forecast;
    expect(f.expectedThisMonth).toBe(1500); // only F is due this month
    expect(f.overdueExpected).toBe(1); // G's expected close date is long past
  });

  it('follows the client customising probabilities', async () => {
    const proposal = ((await get(admin.token, '/api/pipeline/stages')).body.data as { id: number; key: string }[]).find((s) => s.key === 'proposal')!;
    await request(app).patch(`/api/pipeline/stages/${proposal.id}`).set(auth(admin.token)).send({ probability: 100 });
    expect((await metrics(s1.token, '?period=all')).forecast.weighted).toBe(100 + 4000 + 1500);
    await request(app).patch(`/api/pipeline/stages/${proposal.id}`).set(auth(admin.token)).send({ probability: 50 });
  });
});

describe('sales by month', () => {
  it('returns the last 12 months, oldest first, with won value and lost count', async () => {
    const rows = (await metrics(s1.token, '?period=all')).salesByMonth as { month: string; wonCount: number; wonValue: number; lostCount: number }[];
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.month)).toEqual([...rows.map((r) => r.month)].sort());
    expect(rows[11].month).toBe(new Date().toISOString().slice(0, 7));
    expect(rows.reduce((a, r) => a + r.wonCount, 0)).toBe(2);
    expect(rows.reduce((a, r) => a + r.wonValue, 0)).toBe(4000);
    expect(rows.reduce((a, r) => a + r.lostCount, 0)).toBe(2);
  });
});

describe('funnel from the stage history', () => {
  it('counts how many deals reached each stage, the conversion between stages and the days spent in each', async () => {
    const f = (await metrics(s1.token, '?period=all')).funnel as { stage: string; name: string; reached: number; conversionFromPrev: number | null; avgDaysInStage: number | null }[];
    expect(f.map((x) => x.name)).toEqual(['Lead', 'Calificado', 'Propuesta', 'Negociación', 'Ganado']);
    expect(f.map((x) => x.reached)).toEqual([7, 5, 4, 3, 2]); // skipping a stage still counts as having passed it
    expect(f.map((x) => x.conversionFromPrev)).toEqual([null, 71.4, 80, 75, 66.7]);
    expect(f.map((x) => x.avgDaysInStage)).toEqual([5, 9.5, 7.5, null, null]);
  });

  it('only follows deals created in the period', async () => {
    const f = (await metrics(s1.token, '?period=30d')).funnel as { reached: number }[];
    expect(f.map((x) => x.reached)).toEqual([5, 4, 3, 2, 1]); // A (40 days) and G (60 days) are older than 30 days
  });
});

describe('stalled deals', () => {
  it('lists open deals with no stage change for 30+ days', async () => {
    const m = await metrics(s1.token, '?period=all');
    expect(m.summary.stalledCount).toBe(1);
    expect(m.stalled).toEqual([expect.objectContaining({ title: 'G', value: 1000, stage: 'lead', days: 60 })]);
  });
});

describe('origin of leads and loss reasons', () => {
  it('breaks results down by lead source, including deals without one', async () => {
    const rows = (await metrics(s1.token, '?period=all')).bySource as { name: string; deals: number; won: number; lost: number; wonValue: number; winRate: number | null }[];
    expect(rows.map((r) => r.name)).toEqual(['Sin origen', 'Web', 'Recomendación']); // most deals first
    expect(rows.find((r) => r.name === 'Web')).toMatchObject({ deals: 2, won: 1, lost: 1, wonValue: 1000, winRate: 50 });
    expect(rows.find((r) => r.name === 'Recomendación')).toMatchObject({ deals: 1, won: 1, winRate: 100, wonValue: 3000 });
    expect(rows.find((r) => r.name === 'Sin origen')).toMatchObject({ deals: 4, won: 0, lost: 1, winRate: 0 });
  });

  it('counts why deals were lost, and how many have no reason recorded', async () => {
    const rows = (await metrics(s1.token, '?period=all')).lostReasons as { name: string; count: number; value: number }[];
    expect(rows.find((r) => r.name === 'Precio')).toMatchObject({ count: 1, value: 2000 });
    expect(rows.find((r) => r.name === 'Sin motivo')).toMatchObject({ count: 1, value: 500 });
  });

  it('keeps reporting an archived reason by its name', async () => {
    const adminReq = (m: 'delete', url: string) => request(app)[m](url).set(auth(admin.token));
    const price = await optionId('loss_reason', 'Precio');
    expect((await adminReq('delete', `/api/pipeline/options/loss_reason/${price}`)).body.result).toBe('archived');
    const rows = (await metrics(s1.token, '?period=all')).lostReasons as { name: string }[];
    expect(rows.map((r) => r.name)).toContain('Precio');
  });
});

describe('activities', () => {
  it('counts what was completed in the period by type, and what is overdue', async () => {
    const a = (await metrics(s1.token, '?period=30d')).activities;
    expect(a.completedByType).toEqual([{ type: 'call', count: 1 }]);
    expect(a.completed).toBe(1);
    expect(a.overdue).toBe(1);
    // completing the overdue one moves it from "overdue" to "completed"
    const list = (await get(s1.token, '/api/activities?completed=false')).body.data as { id: number; subject: string }[];
    const overdue = list.find((x) => x.subject === 'vencida')!;
    await request(app).patch(`/api/activities/${overdue.id}`).set(auth(s1.token)).send({ completed: true });
    const after = (await metrics(s1.token, '?period=30d')).activities;
    expect(after.overdue).toBe(0);
    expect(after.completedByType.find((t: { type: string }) => t.type === 'task')).toMatchObject({ count: 1 });
    // un-completing clears the completion date
    await request(app).patch(`/api/activities/${overdue.id}`).set(auth(s1.token)).send({ completed: false });
    expect((await metrics(s1.token, '?period=30d')).activities.completedByType.some((t: { type: string }) => t.type === 'task')).toBe(false);
  });
});

describe('who sees what', () => {
  beforeAll(async () => {
    await deal(s2, 'H', 9999, [['lead', 12], ['won', 1]], { closedDaysAgo: 1 });
  });

  it('salespeople only see their own numbers, even if they ask for someone else', async () => {
    expect((await metrics(s1.token, '?period=all')).summary.wonValue).toBe(4000);
    expect((await metrics(s2.token, '?period=all')).summary).toMatchObject({ wonValue: 9999, wonCount: 1 });
    const sneaky = await metrics(s1.token, `?period=all&ownerId=${s2.id}`);
    expect(sneaky.summary.wonValue).toBe(4000);
    expect(sneaky.byOwner).toBeUndefined();
  });

  it('admins see the whole team with a per-salesperson breakdown, or can narrow to one', async () => {
    const all = await metrics(admin.token, '?period=all');
    expect(all.summary.wonValue).toBe(13999);
    expect(all.byOwner.map((o: { ownerId: number }) => o.ownerId)).toEqual([s2.id, s1.id]); // best seller first
    expect(all.byOwner.find((o: { ownerId: number }) => o.ownerId === s1.id)).toMatchObject({ wonCount: 2, wonValue: 4000, lostCount: 2, winRate: 50, openCount: 3, weighted: 3600 });
    const one = await metrics(admin.token, `?period=all&ownerId=${s1.id}`);
    expect(one.summary.wonValue).toBe(4000);
    expect(one.byOwner).toBeUndefined();
    expect((await get(admin.token, '/api/dashboard/metrics?ownerId=abc')).status).toBe(400);
  });
});

describe('dashboard stats follow the configured pipeline', () => {
  it('returns one row per stage with its name and kind, and totals by kind', async () => {
    const r = (await get(s1.token, '/api/dashboard/stats')).body;
    expect(r.dealsByStage.map((s: { stage: string }) => s.stage)).toEqual(['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost']);
    expect(r.dealsByStage[4]).toMatchObject({ name: 'Ganado', kind: 'won', count: 2, value: 4000 });
    expect(r.totals).toMatchObject({ openDealsValue: 7000, wonDealsValue: 4000 });

    // a custom "won" stage is counted as won too
    await request(app).post('/api/pipeline/stages').set(auth(admin.token)).send({ name: 'Renovado', kind: 'won' });
    await deal(s1, 'I', 700, [['lead', 2], ['renovado', 1]], { closedDaysAgo: 1 });
    const after = (await get(s1.token, '/api/dashboard/stats')).body;
    expect(after.totals.wonDealsValue).toBe(4700);
    expect((await metrics(s1.token, '?period=all')).summary).toMatchObject({ wonCount: 3, wonValue: 4700 });
  });
});

describe('assistant tools', () => {
  it('get_pipeline and get_metrics answer from the same data, with the caller’s permissions', async () => {
    const pipeline = await executeTool('get_pipeline', {}, s1.token);
    expect(pipeline.ok).toBe(true);
    const p = JSON.parse(pipeline.content);
    expect(p.stages.map((s: { key: string }) => s.key)).toContain('renovado');
    expect(p.leadSources.length).toBeGreaterThan(0);

    const m = await executeTool('get_metrics', { period: '30d' }, s1.token);
    expect(m.ok).toBe(true);
    expect(JSON.parse(m.content).period).toBe('30d');
    expect((await executeTool('get_metrics', { period: 'week' }, s1.token)).ok).toBe(false);
  });
});
