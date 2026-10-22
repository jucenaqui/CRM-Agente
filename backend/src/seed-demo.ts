/**
 * Demo data: `npm run seed:demo` adds a year of realistic sales activity so the dashboard metrics
 * have something to show; `npm run seed:demo -- --remove` deletes exactly what it added.
 *
 * Everything it creates hangs off companies whose website ends in `.demo.example` (plus the demo
 * salesperson marcos@crm.local), which is how it finds it again. Your own records are never touched.
 * Dates are relative to today, so the data always looks current. The random generator is seeded:
 * running it on two empty databases gives the same dataset.
 */
import { getDbPath, isProduction, loadEnv } from './config.js';

loadEnv();

if (isProduction() && process.env.SEED_ALLOW_PRODUCTION !== '1') {
  console.error('Seed demo cancelado: NODE_ENV=production. Para forzarlo en un entorno de demostración: SEED_ALLOW_PRODUCTION=1.');
  process.exit(1);
}

const DEMO_DOMAIN = 'demo.example';
const remove = process.argv.includes('--remove');

const { getDb } = await import('./db.js');
const { findUserByEmail, hashPassword, insertUser } = await import('./lib/users.js');
const { getStages } = await import('./lib/pipeline.js');
const { computeMetrics } = await import('./lib/metrics.js');

const db = getDb();
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const inDays = (days: number) => new Date(NOW + days * DAY).toISOString();

const demoCompanyIds = () =>
  (db.prepare('SELECT id FROM companies WHERE website LIKE ?').all(`%.${DEMO_DOMAIN}`) as { id: number }[]).map((r) => r.id);

// ---------------------------------------------------------------- remove ----
if (remove) {
  const companies = demoCompanyIds();
  if (companies.length === 0) {
    console.log('No hay datos de demostración que quitar.');
    process.exit(0);
  }
  const ids = (sql: string, ...p: unknown[]) => (db.prepare(sql).all(...p) as { id: number }[]).map((r) => r.id);
  const inList = (xs: number[]) => (xs.length ? xs.join(',') : 'NULL');
  db.transaction(() => {
    const dealIds = ids(`SELECT id FROM deals WHERE companyId IN (${inList(companies)})`);
    const contactIds = ids(`SELECT id FROM contacts WHERE companyId IN (${inList(companies)})`);
    db.exec(`DELETE FROM activities WHERE dealId IN (${inList(dealIds)}) OR contactId IN (${inList(contactIds)})`);
    db.exec(`DELETE FROM deals WHERE id IN (${inList(dealIds)})`); // stage history goes with them
    db.exec(`DELETE FROM contacts WHERE id IN (${inList(contactIds)})`);
    db.exec(`DELETE FROM companies WHERE id IN (${inList(companies)})`);
    const marcos = findUserByEmail('marcos@crm.local');
    if (marcos) db.prepare('DELETE FROM users WHERE id = ?').run(marcos.id);
  })();
  console.log(`Datos de demostración eliminados (${companies.length} empresas y todo lo que colgaba de ellas).`);
  process.exit(0);
}

// ------------------------------------------------------------------- add ----
if (demoCompanyIds().length > 0) {
  console.log('Los datos de demostración ya están cargados. Quítalos primero con: npm run seed:demo -- --remove');
  process.exit(0);
}

// deterministic random numbers
let seed = 20261022;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a: number, b: number) => a + rnd() * (b - a);
const intBetween = (a: number, b: number) => Math.floor(between(a, b + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const weighted = <T,>(items: readonly (readonly [T, number])[]): T => {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[items.length - 1]![0];
};
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);

// the client may have customised the pipeline: work with whatever stages exist
const stages = getStages();
const openStages = stages.filter((s) => s.kind === 'open');
const wonStage = stages.find((s) => s.kind === 'won')!;
const lostStage = stages.find((s) => s.kind === 'lost')!;
const optionId = (kind: string, name: string): number | null =>
  (db.prepare('SELECT id FROM crm_options WHERE kind = ? AND name = ? AND archivedAt IS NULL').get(kind, name) as { id: number } | undefined)?.id ?? null;

// salespeople
const ensureUser = async (name: string, email: string) => {
  const u = findUserByEmail(email);
  if (u) return u.id;
  return insertUser({ name, email, passwordHash: await hashPassword('Sales123!'), role: 'sales' }).id;
};
const admin = findUserByEmail('admin@crm.local') ?? (db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() as { id: number });
const owners: (readonly [number, number])[] = [
  [admin.id, 2],
  [await ensureUser('Sally Sales', 'sales@crm.local'), 3],
  [await ensureUser('Marcos Ruiz', 'marcos@crm.local'), 3],
];

const COMPANIES: [string, string][] = [
  ['Grupo Andino Logística', 'Logística'],
  ['Clínica Santa Aurora', 'Salud'],
  ['Estudio Nube Creativa', 'Diseño'],
  ['Ferretería El Tornillo', 'Comercio'],
  ['Inmobiliaria Horizonte', 'Inmobiliaria'],
  ['Colegio Nuevo Mundo', 'Educación'],
  ['Café Origen', 'Hostelería'],
  ['Taller Mecánico Pérez', 'Automoción'],
  ['Bufete Salazar & Asociados', 'Servicios legales'],
  ['Panadería La Espiga', 'Alimentación'],
  ['Veterinaria Patitas', 'Salud animal'],
  ['Constructora Altamira', 'Construcción'],
  ['Agencia de Viajes Brújula', 'Turismo'],
  ['Gimnasio Fuerza Viva', 'Deporte'],
];
const FIRST = ['Lucía', 'Andrés', 'Camila', 'Javier', 'Valentina', 'Diego', 'Sofía', 'Mateo', 'Isabella', 'Carlos', 'Daniela', 'Felipe'];
const LAST = ['García', 'Rojas', 'Mendoza', 'Torres', 'Vargas', 'Castillo', 'Herrera', 'Molina', 'Ortega', 'Silva', 'Ramírez', 'Navarro'];
const POSITIONS = ['Gerente', 'Directora', 'Dueño', 'Responsable de compras', 'Administrador', 'Coordinadora'];
const PRODUCTS: [string, number, number][] = [
  ['Licencia anual', 1500, 9000],
  ['Implementación', 4000, 22000],
  ['Consultoría', 2000, 12000],
  ['Plan premium', 3000, 15000],
  ['Soporte 24/7', 1000, 6000],
  ['Capacitación', 800, 5000],
  ['Proyecto a medida', 8000, 40000],
];
// win probability by lead source (what the "origin" report should reveal)
const SOURCES: readonly (readonly [string, number, number])[] = [
  // name, how often it brings a lead, win probability
  ['Recomendación', 18, 0.7],
  ['Web', 28, 0.42],
  ['Evento', 12, 0.4],
  ['Redes sociales', 18, 0.28],
  ['Publicidad', 14, 0.22],
  ['Llamada en frío', 10, 0.12],
];
const REASONS: readonly (readonly [string, number])[] = [
  ['Precio', 34],
  ['Eligió a la competencia', 24],
  ['Sin presupuesto', 16],
  ['Sin respuesta', 14],
  ['No era el momento', 12],
];

const insCompany = db.prepare('INSERT INTO companies (name, industry, website, phone, address, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const insContact = db.prepare('INSERT INTO contacts (firstName, lastName, email, phone, position, companyId, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const insDeal = db.prepare(
  `INSERT INTO deals (title, value, currency, stage, contactId, companyId, ownerId, expectedCloseDate, createdAt, updatedAt, closedAt, sourceId, lostReasonId)
   VALUES (?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insHistory = db.prepare('INSERT INTO deal_stage_history (dealId, fromStage, toStage, changedAt, changedBy) VALUES (?, ?, ?, ?, ?)');
const insActivity = db.prepare(
  `INSERT INTO activities (type, subject, description, dueDate, completed, contactId, dealId, ownerId, createdAt, completedAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

interface Lead {
  companyId: number;
  contactId: number;
  ownerId: number;
}
const leads: Lead[] = [];
const dealCount = { won: 0, lost: 0, open: 0 };
const dealsForActivities: { id: number; contactId: number; ownerId: number }[] = [];

db.transaction(() => {
  for (const [name, industry] of COMPANIES) {
    const created = ago(between(200, 380));
    const owner = weighted(owners);
    const companyId = Number(
      insCompany.run(name, industry, `https://www.${slug(name)}.${DEMO_DOMAIN}`, `+57 300 ${intBetween(100, 999)} ${intBetween(1000, 9999)}`, 'Calle ' + intBetween(1, 99) + ' # ' + intBetween(1, 99), owner, created, created).lastInsertRowid,
    );
    for (let k = 0; k < 2; k++) {
      const first = pick(FIRST);
      const last = pick(LAST);
      const contactId = Number(
        insContact.run(first, last, `${slug(first)}.${slug(last)}@${slug(name)}.${DEMO_DOMAIN}`, `+57 31${intBetween(0, 9)} ${intBetween(100, 999)} ${intBetween(1000, 9999)}`, pick(POSITIONS), companyId, owner, created, created).lastInsertRowid,
      );
      leads.push({ companyId, contactId, ownerId: owner });
    }
  }

  /** Walks a deal through `path` (stage keys), spreading the steps between `start` and `end`. */
  const recordPath = (dealId: number, path: string[], start: number, end: number, ownerId: number) => {
    const span = Math.max(DAY, end - start);
    const cuts = path.map(() => rnd()).sort((a, b) => a - b);
    path.forEach((stage, i) => {
      const at = i === 0 ? start : i === path.length - 1 ? end : start + span * cuts[i]!;
      insHistory.run(dealId, i === 0 ? null : path[i - 1], stage, new Date(Math.min(Math.max(at, start), end)).toISOString(), ownerId);
    });
  };

  // ---- closed deals over the last 12 months: more recent months a bit busier ----
  for (let monthsBack = 11; monthsBack >= 0; monthsBack--) {
    const count = intBetween(4, 7) + (monthsBack < 4 ? 1 : 0);
    for (let n = 0; n < count; n++) {
      const lead = pick(leads);
      const owner = weighted(owners);
      const [sourceName, , winRate] = weighted(SOURCES.map((s) => [s, s[1]] as const));
      const [product, lo, hi] = pick(PRODUCTS);
      const value = Math.round(between(lo, hi) / 50) * 50;
      const closedDaysAgo = Math.max(0.5, monthsBack * 30 + between(0, 28));
      const cycleDays = Math.round(between(8, 45) + value / 1500); // bigger deals take longer
      const won = rnd() < winRate;
      const closed = NOW - closedDaysAgo * DAY;
      const created = closed - cycleDays * DAY;
      const reached = won ? openStages.length : intBetween(0, openStages.length - 1); // lost ones drop out somewhere
      const path = [...openStages.slice(0, Math.max(1, reached)).map((s) => s.key), (won ? wonStage : lostStage).key];
      const reason = won || rnd() < 0.14 ? null : optionId('loss_reason', weighted(REASONS));
      const dealId = Number(
        insDeal.run(
          `${product} — ${db.prepare('SELECT name FROM companies WHERE id = ?').get(lead.companyId) ? (db.prepare('SELECT name FROM companies WHERE id = ?').get(lead.companyId) as { name: string }).name : ''}`,
          value,
          path[path.length - 1],
          lead.contactId,
          lead.companyId,
          owner,
          new Date(closed).toISOString(),
          new Date(created).toISOString(),
          new Date(closed).toISOString(),
          new Date(closed).toISOString(),
          optionId('lead_source', sourceName),
          reason,
        ).lastInsertRowid,
      );
      recordPath(dealId, path, created, closed, owner);
      dealCount[won ? 'won' : 'lost']++;
      dealsForActivities.push({ id: dealId, contactId: lead.contactId, ownerId: owner });
    }
  }

  // ---- open deals: some moving, some stalled, a few with an overdue expected close ----
  const stalledLeft = { n: 3 };
  const overdueLeft = { n: 2 };
  const thisMonthLeft = { n: 3 };
  for (let n = 0; n < 16; n++) {
    const lead = pick(leads);
    const owner = weighted(owners);
    const [sourceName] = weighted(SOURCES.map((s) => [s, s[1]] as const));
    const [product, lo, hi] = pick(PRODUCTS);
    const value = Math.round(between(lo, hi) / 50) * 50;
    const stageIndex = weighted(openStages.map((_, i) => [i, Math.max(1, 5 - i)] as const));
    const stalled = stalledLeft.n > 0 && n % 5 === 2;
    if (stalled) stalledLeft.n--;
    const createdAgo = stalled ? between(55, 95) : between(6, 70);
    const lastChangeAgo = stalled ? between(34, Math.min(50, createdAgo - 1)) : between(0.5, Math.min(20, createdAgo - 1));
    let expected: string | null;
    if (overdueLeft.n > 0 && n % 7 === 3) {
      overdueLeft.n--;
      expected = ago(between(3, 25));
    } else if (thisMonthLeft.n > 0 && n % 4 === 1) {
      thisMonthLeft.n--;
      expected = inDays(between(0, 2));
    } else expected = inDays(between(10, 70));
    const path = openStages.slice(0, stageIndex + 1).map((s) => s.key);
    const dealId = Number(
      insDeal.run(
        `${product} — ${(db.prepare('SELECT name FROM companies WHERE id = ?').get(lead.companyId) as { name: string }).name}`,
        value,
        path[path.length - 1],
        lead.contactId,
        lead.companyId,
        owner,
        expected,
        ago(createdAgo),
        ago(lastChangeAgo),
        null,
        optionId('lead_source', sourceName),
        null,
      ).lastInsertRowid,
    );
    recordPath(dealId, path, NOW - createdAgo * DAY, NOW - lastChangeAgo * DAY, owner);
    dealCount.open++;
    dealsForActivities.push({ id: dealId, contactId: lead.contactId, ownerId: owner });
  }

  // ---- activities: done in the last 90 days, a few upcoming and a few overdue ----
  const TYPES = [['call', 40], ['email', 28], ['meeting', 16], ['task', 10], ['note', 6]] as const;
  const SUBJECTS: Record<string, string[]> = {
    call: ['Llamada de seguimiento', 'Llamada de presentación', 'Confirmar recepción de propuesta'],
    email: ['Enviar propuesta', 'Enviar resumen de la reunión', 'Responder dudas del cliente'],
    meeting: ['Reunión de descubrimiento', 'Demostración del producto', 'Reunión de cierre'],
    task: ['Preparar contrato', 'Revisar condiciones', 'Actualizar datos del cliente'],
    note: ['Notas de la llamada', 'Acuerdos de la reunión'],
  };
  const addActivity = (completed: boolean, dueOffsetDays: number) => {
    const d = pick(dealsForActivities);
    const type = weighted(TYPES.map((t) => [t[0], t[1]] as const));
    const due = NOW + dueOffsetDays * DAY;
    const done = completed ? due : null;
    insActivity.run(type, pick(SUBJECTS[type]!), null, new Date(due).toISOString(), completed ? 1 : 0, d.contactId, d.id, d.ownerId, new Date(Math.min(due, NOW) - between(1, 6) * DAY).toISOString(), done ? new Date(done).toISOString() : null);
  };
  for (let i = 0; i < 70; i++) addActivity(true, -between(0.2, 89));
  for (let i = 0; i < 6; i++) addActivity(false, between(0.5, 12)); // upcoming
  for (let i = 0; i < 4; i++) addActivity(false, -between(1, 9)); // overdue
})();

const m = computeMetrics({ period: '12m', includeTeam: true });
const money = (n: number) => `$${Math.round(n).toLocaleString('es')}`;
console.log(`Datos de demostración cargados (db: ${getDbPath()})`);
console.log(`  ${COMPANIES.length} empresas, ${leads.length} contactos, ${dealCount.won} deals ganados, ${dealCount.lost} perdidos y ${dealCount.open} abiertos, 80 actividades.`);
console.log(`  Últimos 12 meses (todo el equipo): ganado ${money(m.summary.wonValue)}, conversión ${m.summary.winRate} %, ciclo ${m.summary.avgCycleDays} días, pronóstico ${money(m.summary.weightedForecast)}, ${m.summary.stalledCount} deals estancados.`);
console.log('  Para quitarlos: npm run seed:demo -- --remove');
