import { Router } from 'express';
import { getDb, nowIso } from '../db.js';
import { currentUser, isAdmin } from '../lib/auth.js';
import type { Row } from '../lib/crud.js';
import { badRequest } from '../lib/errors.js';
import { PERIODS, computeMetrics, type Period } from '../lib/metrics.js';
import { getStages } from '../lib/pipeline.js';
import { mapActivity } from './activities.js';

const router = Router();

const UPCOMING_LIMIT = 5;

router.get('/stats', (req, res) => {
  const db = getDb();
  const user = currentUser(req);
  const admin = isAdmin(req);
  const own = admin ? '' : 'WHERE ownerId = ?';
  const ownAnd = admin ? '' : 'AND ownerId = ?';
  const p = admin ? [] : [user.id];

  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${own}`).get(...p) as { n: number }).n;

  const byStage = db
    .prepare(
      `SELECT stage, COUNT(*) AS count, COALESCE(SUM(value), 0) AS value FROM deals ${own} GROUP BY stage`,
    )
    .all(...p) as { stage: string; count: number; value: number }[];
  // One row per stage of the pipeline, in pipeline order (empty stages included).
  const dealsByStage = getStages().map((s) => {
    const r = byStage.find((x) => x.stage === s.key);
    return { stage: s.key, name: s.name, kind: s.kind, color: s.color, count: r?.count ?? 0, value: r?.value ?? 0 };
  });
  const sum = (kind: 'open' | 'won') => dealsByStage.filter((d) => d.kind === kind).reduce((a, d) => a + d.value, 0);

  // Upcoming = not completed, with a due date from now on, soonest first.
  const upcoming = db
    .prepare(
      `SELECT * FROM activities WHERE completed = 0 AND dueDate IS NOT NULL AND dueDate >= ? ${ownAnd}
       ORDER BY dueDate ASC, id ASC LIMIT ?`,
    )
    .all(nowIso(), ...p, UPCOMING_LIMIT) as Row[];

  res.json({
    totals: {
      companies: count('companies'),
      contacts: count('contacts'),
      deals: count('deals'),
      openDealsValue: sum('open'),
      wonDealsValue: sum('won'),
    },
    dealsByStage,
    upcomingActivities: upcoming.map(mapActivity),
  });
});

/**
 * Sales metrics for a period (?period=30d|90d|12m|all, default 90d). Salespeople see their own
 * numbers; admins see the whole team, optionally narrowed with ?ownerId=.
 */
router.get('/metrics', (req, res) => {
  const raw = typeof req.query.period === 'string' ? req.query.period : '90d';
  if (!PERIODS.includes(raw as Period)) throw badRequest(`Periodo no válido. Permitidos: ${PERIODS.join(', ')}`);
  const user = currentUser(req);
  let ownerId: number | undefined = isAdmin(req) ? undefined : user.id;
  if (isAdmin(req) && req.query.ownerId !== undefined && req.query.ownerId !== '') {
    const n = Number(req.query.ownerId);
    if (!Number.isInteger(n) || n < 1) throw badRequest('ownerId no válido');
    ownerId = n;
  }
  res.json(computeMetrics({ period: raw as Period, ownerId, includeTeam: ownerId === undefined }));
});

export default router;
