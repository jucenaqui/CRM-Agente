import { getDb, nowIso } from '../db.js';
import { getStages, type Stage } from './pipeline.js';

/**
 * Sales metrics, computed on demand from deals, their stage history and activities.
 * `ownerId` limits everything to one salesperson (always the caller for non-admins).
 *
 * Values are summed as plain numbers: if deals use several currencies the totals mix them
 * (the CRM stores one currency per deal but does not convert).
 */
export type Period = '30d' | '90d' | '12m' | 'all';
export const PERIODS: readonly Period[] = ['30d', '90d', '12m', 'all'];

const DAY = 24 * 60 * 60 * 1000;
const STALLED_DAYS = 30;

const periodStart = (p: Period): string => {
  const days = p === '30d' ? 30 : p === '90d' ? 90 : p === '12m' ? 365 : null;
  return days === null ? '1970-01-01T00:00:00.000Z' : new Date(Date.now() - days * DAY).toISOString();
};

const round = (n: number, d = 1): number => Math.round(n * 10 ** d) / 10 ** d;
const rate = (a: number, b: number): number | null => (b > 0 ? round((a / b) * 100) : null);

interface DealRow {
  id: number;
  title: string;
  value: number;
  stage: string;
  ownerId: number;
  createdAt: string;
  closedAt: string | null;
  expectedCloseDate: string | null;
  sourceId: number | null;
  lostReasonId: number | null;
}

export interface Metrics {
  period: Period;
  from: string;
  generatedAt: string;
  summary: {
    wonCount: number;
    wonValue: number;
    lostCount: number;
    lostValue: number;
    /** won / (won + lost) among deals closed in the period, in %. */
    winRate: number | null;
    avgDealSize: number | null;
    /** Average days from creation to winning, for deals won in the period. */
    avgCycleDays: number | null;
    openCount: number;
    openValue: number;
    weightedForecast: number;
    stalledCount: number;
    overdueActivities: number;
  };
  salesByMonth: { month: string; wonCount: number; wonValue: number; lostCount: number }[];
  forecast: {
    weighted: number;
    expectedThisMonth: number;
    overdueExpected: number;
    byStage: { stage: string; name: string; probability: number; count: number; value: number; weighted: number }[];
  };
  funnel: { stage: string; name: string; kind: Stage['kind']; reached: number; conversionFromPrev: number | null; avgDaysInStage: number | null }[];
  bySource: { sourceId: number | null; name: string; deals: number; won: number; lost: number; wonValue: number; winRate: number | null }[];
  lostReasons: { reasonId: number | null; name: string; count: number; value: number }[];
  activities: { completed: number; overdue: number; completedByType: { type: string; count: number }[] };
  stalled: { id: number; title: string; value: number; stage: string; days: number }[];
  /** Only when looking at the whole team (admins). */
  byOwner?: { ownerId: number; name: string; openCount: number; openValue: number; weighted: number; wonCount: number; wonValue: number; lostCount: number; winRate: number | null; activitiesCompleted: number }[];
}

export function computeMetrics(opts: { period: Period; ownerId?: number; includeTeam?: boolean }): Metrics {
  const db = getDb();
  const { period } = opts;
  const from = periodStart(period);
  const now = nowIso();
  const stages = getStages();
  const stageByKey = new Map(stages.map((s) => [s.key, s]));
  const open = stages.filter((s) => s.kind === 'open');
  const ownerSql = opts.ownerId !== undefined ? ' AND d.ownerId = ?' : '';
  const ownerParams = (...before: unknown[]) => (opts.ownerId !== undefined ? [...before, opts.ownerId] : before);

  const allDeals = db
    .prepare(`SELECT d.id, d.title, d.value, d.stage, d.ownerId, d.createdAt, d.closedAt, d.expectedCloseDate, d.sourceId, d.lostReasonId FROM deals d WHERE 1=1${ownerSql}`)
    .all(...ownerParams()) as unknown as DealRow[];
  const kindOf = (d: DealRow) => stageByKey.get(d.stage)?.kind ?? 'open';

  // ---- closed in the period ----
  const closed = allDeals.filter((d) => kindOf(d) !== 'open' && d.closedAt && d.closedAt >= from);
  const won = closed.filter((d) => kindOf(d) === 'won');
  const lost = closed.filter((d) => kindOf(d) === 'lost');
  const wonValue = won.reduce((a, d) => a + d.value, 0);
  const cycleDays = won.map((d) => (Date.parse(d.closedAt!) - Date.parse(d.createdAt)) / DAY).filter((n) => Number.isFinite(n) && n >= 0);

  // ---- open pipeline & forecast ----
  const openDeals = allDeals.filter((d) => kindOf(d) === 'open');
  const monthPrefix = now.slice(0, 7);
  const today = now.slice(0, 10);
  const byStage = open.map((s) => {
    const ds = openDeals.filter((d) => d.stage === s.key);
    const value = ds.reduce((a, d) => a + d.value, 0);
    return { stage: s.key, name: s.name, probability: s.probability, count: ds.length, value, weighted: round((value * s.probability) / 100, 2) };
  });
  const weightedOf = (d: DealRow) => (d.value * (stageByKey.get(d.stage)?.probability ?? 0)) / 100;
  const weighted = round(byStage.reduce((a, s) => a + s.weighted, 0), 2);
  const expectedThisMonth = round(openDeals.filter((d) => d.expectedCloseDate?.startsWith(monthPrefix)).reduce((a, d) => a + weightedOf(d), 0), 2);
  const overdueExpected = openDeals.filter((d) => d.expectedCloseDate && d.expectedCloseDate.slice(0, 10) < today).length;

  // ---- sales by month (last 12 months, including empty ones) ----
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const monthStart = `${months[0]}-01T00:00:00.000Z`;
  const salesByMonth = months.map((month) => ({ month, wonCount: 0, wonValue: 0, lostCount: 0 }));
  for (const d of allDeals) {
    const k = kindOf(d);
    if (k === 'open' || !d.closedAt || d.closedAt < monthStart) continue;
    const row = salesByMonth.find((m) => m.month === d.closedAt!.slice(0, 7));
    if (!row) continue;
    if (k === 'won') {
      row.wonCount++;
      row.wonValue += d.value;
    } else row.lostCount++;
  }

  // ---- funnel (deals created in the period) & time in stage, from the stage history ----
  const cohort = allDeals.filter((d) => d.createdAt >= from);
  const cohortIds = new Set(cohort.map((d) => d.id));
  const history = (db.prepare('SELECT dealId, toStage, changedAt FROM deal_stage_history ORDER BY dealId, id').all() as unknown as { dealId: number; toStage: string; changedAt: string }[]).filter((h) => cohortIds.has(h.dealId));
  const byDeal = new Map<number, { toStage: string; changedAt: string }[]>();
  for (const h of history) (byDeal.get(h.dealId) ?? byDeal.set(h.dealId, []).get(h.dealId)!).push(h);

  const openPos = new Map(open.map((s, i) => [s.key, i + 1])); // 1..n
  const wonLevel = open.length + 1;
  const reachedAt = new Array<number>(wonLevel + 1).fill(0); // reachedAt[level]
  for (const d of cohort) {
    let level = 1; // every deal starts at the first stage
    for (const h of byDeal.get(d.id) ?? []) {
      const st = stageByKey.get(h.toStage);
      if (!st) continue;
      level = Math.max(level, st.kind === 'open' ? (openPos.get(st.key) ?? 1) : st.kind === 'won' ? wonLevel : 1);
    }
    for (let l = 1; l <= level; l++) reachedAt[l]++;
  }
  const stayDays = new Map<string, number[]>();
  for (const rows of byDeal.values()) {
    for (let i = 0; i + 1 < rows.length; i++) {
      const days = (Date.parse(rows[i + 1].changedAt) - Date.parse(rows[i].changedAt)) / DAY;
      if (Number.isFinite(days) && days >= 0) (stayDays.get(rows[i].toStage) ?? stayDays.set(rows[i].toStage, []).get(rows[i].toStage)!).push(days);
    }
  }
  const avg = (xs: number[] | undefined) => (xs && xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const firstWon = stages.find((s) => s.kind === 'won');
  const funnel: Metrics['funnel'] = open.map((s, i) => ({
    stage: s.key,
    name: s.name,
    kind: s.kind,
    reached: reachedAt[i + 1],
    conversionFromPrev: i === 0 ? null : rate(reachedAt[i + 1], reachedAt[i]),
    avgDaysInStage: avg(stayDays.get(s.key)),
  }));
  if (firstWon) {
    funnel.push({
      stage: firstWon.key,
      name: firstWon.name,
      kind: 'won',
      reached: reachedAt[wonLevel],
      conversionFromPrev: rate(reachedAt[wonLevel], reachedAt[open.length]),
      avgDaysInStage: null,
    });
  }

  // ---- stalled open deals: no stage change for STALLED_DAYS ----
  const lastChange = new Map<number, string>();
  for (const h of db.prepare('SELECT dealId, MAX(changedAt) AS last FROM deal_stage_history GROUP BY dealId').all() as unknown as { dealId: number; last: string }[]) {
    lastChange.set(h.dealId, h.last);
  }
  const stalledAll = openDeals
    .map((d) => ({ d, days: Math.floor((Date.now() - Date.parse(lastChange.get(d.id) ?? d.createdAt)) / DAY) }))
    .filter((x) => x.days >= STALLED_DAYS)
    .sort((a, b) => b.days - a.days);

  // ---- origin of leads & loss reasons ----
  const optionName = new Map(
    (db.prepare('SELECT id, name FROM crm_options').all() as unknown as { id: number; name: string }[]).map((o) => [o.id, o.name]),
  );
  const sources = new Map<number | null, { deals: number; won: number; lost: number; wonValue: number }>();
  for (const d of cohort) {
    const s = sources.get(d.sourceId) ?? { deals: 0, won: 0, lost: 0, wonValue: 0 };
    s.deals++;
    const k = kindOf(d);
    if (k === 'won') {
      s.won++;
      s.wonValue += d.value;
    } else if (k === 'lost') s.lost++;
    sources.set(d.sourceId, s);
  }
  const bySource = [...sources.entries()]
    .map(([sourceId, s]) => ({ sourceId, name: sourceId === null ? 'Sin origen' : (optionName.get(sourceId) ?? 'Desconocido'), ...s, winRate: rate(s.won, s.won + s.lost) }))
    .sort((a, b) => b.deals - a.deals);

  const reasons = new Map<number | null, { count: number; value: number }>();
  for (const d of lost) {
    const r = reasons.get(d.lostReasonId) ?? { count: 0, value: 0 };
    r.count++;
    r.value += d.value;
    reasons.set(d.lostReasonId, r);
  }
  const lostReasons = [...reasons.entries()]
    .map(([reasonId, r]) => ({ reasonId, name: reasonId === null ? 'Sin motivo' : (optionName.get(reasonId) ?? 'Desconocido'), ...r }))
    .sort((a, b) => b.count - a.count);

  // ---- activities ----
  const actOwner = opts.ownerId !== undefined ? ' AND ownerId = ?' : '';
  const completedByType = db
    .prepare(`SELECT type, COUNT(*) AS count FROM activities WHERE completedAt >= ?${actOwner} GROUP BY type ORDER BY count DESC`)
    .all(...ownerParams(from)) as unknown as { type: string; count: number }[];
  const overdueActivities = (
    db.prepare(`SELECT COUNT(*) AS n FROM activities WHERE completed = 0 AND dueDate IS NOT NULL AND dueDate < ?${actOwner}`).get(...ownerParams(now)) as { n: number }
  ).n;

  const result: Metrics = {
    period,
    from,
    generatedAt: now,
    summary: {
      wonCount: won.length,
      wonValue,
      lostCount: lost.length,
      lostValue: lost.reduce((a, d) => a + d.value, 0),
      winRate: rate(won.length, won.length + lost.length),
      avgDealSize: won.length ? round(wonValue / won.length, 2) : null,
      avgCycleDays: avg(cycleDays),
      openCount: openDeals.length,
      openValue: openDeals.reduce((a, d) => a + d.value, 0),
      weightedForecast: weighted,
      stalledCount: stalledAll.length,
      overdueActivities,
    },
    salesByMonth,
    forecast: { weighted, expectedThisMonth, overdueExpected, byStage },
    funnel,
    bySource,
    lostReasons,
    activities: { completed: completedByType.reduce((a, t) => a + t.count, 0), overdue: overdueActivities, completedByType },
    stalled: stalledAll.slice(0, 5).map(({ d, days }) => ({ id: d.id, title: d.title, value: d.value, stage: d.stage, days })),
  };

  if (opts.includeTeam) {
    const users = db.prepare('SELECT id, name FROM users ORDER BY name').all() as unknown as { id: number; name: string }[];
    const done = new Map(
      (db.prepare('SELECT ownerId, COUNT(*) AS n FROM activities WHERE completedAt >= ? GROUP BY ownerId').all(from) as unknown as { ownerId: number; n: number }[]).map((r) => [r.ownerId, r.n]),
    );
    result.byOwner = users
      .map((u) => {
        const mine = allDeals.filter((d) => d.ownerId === u.id);
        const mineOpen = mine.filter((d) => kindOf(d) === 'open');
        const mineWon = mine.filter((d) => kindOf(d) === 'won' && d.closedAt && d.closedAt >= from);
        const mineLost = mine.filter((d) => kindOf(d) === 'lost' && d.closedAt && d.closedAt >= from);
        return {
          ownerId: u.id,
          name: u.name,
          openCount: mineOpen.length,
          openValue: mineOpen.reduce((a, d) => a + d.value, 0),
          weighted: round(mineOpen.reduce((a, d) => a + weightedOf(d), 0), 2),
          wonCount: mineWon.length,
          wonValue: mineWon.reduce((a, d) => a + d.value, 0),
          lostCount: mineLost.length,
          winRate: rate(mineWon.length, mineWon.length + mineLost.length),
          activitiesCompleted: done.get(u.id) ?? 0,
        };
      })
      .filter((o) => o.openCount + o.wonCount + o.lostCount + o.activitiesCompleted > 0)
      .sort((a, b) => b.wonValue - a.wonValue);
  }
  return result;
}
