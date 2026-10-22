import { Router } from 'express';
import { getDb, nowIso } from '../db.js';
import { currentUser, isAdmin } from '../lib/auth.js';
import type { Row } from '../lib/crud.js';
import { mapActivity } from './activities.js';
import { STAGES } from './deals.js';

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
  const dealsByStage = STAGES.map((stage) => {
    const r = byStage.find((s) => s.stage === stage);
    return { stage, count: r?.count ?? 0, value: r?.value ?? 0 };
  });
  const sum = (pred: (s: string) => boolean) =>
    dealsByStage.filter((d) => pred(d.stage)).reduce((a, d) => a + d.value, 0);

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
      openDealsValue: sum((s) => s !== 'won' && s !== 'lost'),
      wonDealsValue: sum((s) => s === 'won'),
    },
    dealsByStage,
    upcomingActivities: upcoming.map(mapActivity),
  });
});

export default router;
