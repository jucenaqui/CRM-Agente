/* Seed script: `npm run seed`. Idempotent: upserts users, inserts sample data only if empty. */
import { getDbPath, isProduction, loadEnv } from './config.js';

loadEnv();

// The seed creates/resets admin@crm.local and sales@crm.local with publicly known passwords:
// never on a production install unless explicitly forced (e.g. a throw-away demo environment).
if (isProduction() && process.env.SEED_ALLOW_PRODUCTION !== '1') {
  console.error(
    'Seed cancelado: NODE_ENV=production y el seed crea usuarios con contraseñas conocidas (admin@crm.local / Admin123!).\n' +
      'Crea el primer administrador registrándote en la aplicación. Para forzarlo en un entorno de demostración: SEED_ALLOW_PRODUCTION=1.',
  );
  process.exit(1);
}

const { getDb, nowIso } = await import('./db.js');
const { findUserByEmail, hashPassword, insertUser } = await import('./lib/users.js');

const db = getDb();

async function ensureUser(name: string, email: string, password: string, role: 'admin' | 'sales') {
  const existing = findUserByEmail(email);
  if (existing) {
    db.prepare('UPDATE users SET role = ?, passwordHash = ? WHERE id = ?').run(
      role,
      await hashPassword(password),
      existing.id,
    );
    return existing.id;
  }
  return insertUser({ name, email, passwordHash: await hashPassword(password), role }).id;
}

const adminId = await ensureUser('Admin', 'admin@crm.local', 'Admin123!', 'admin');
const salesId = await ensureUser('Sally Sales', 'sales@crm.local', 'Sales123!', 'sales');

const { n } = db.prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number };
if (n > 0) {
  console.log(`Seed: users ensured; sample data already present (db: ${getDbPath()})`);
  process.exit(0);
}

const now = nowIso();
const day = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.now() + d * day).toISOString();

const insCompany = db.prepare(
  `INSERT INTO companies (name, industry, website, phone, address, ownerId, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insContact = db.prepare(
  `INSERT INTO contacts (firstName, lastName, email, phone, position, companyId, ownerId, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insDeal = db.prepare(
  `INSERT INTO deals (title, value, currency, stage, contactId, companyId, ownerId, expectedCloseDate, createdAt, updatedAt, closedAt, sourceId, lostReasonId)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insHistory = db.prepare(
  'INSERT INTO deal_stage_history (dealId, fromStage, toStage, changedAt, changedBy) VALUES (?, ?, ?, ?, ?)',
);
const optionId = (kind: string, name: string): number | null =>
  (db.prepare('SELECT id FROM crm_options WHERE kind = ? AND name = ?').get(kind, name) as { id: number } | undefined)?.id ?? null;
const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
const insActivity = db.prepare(
  `INSERT INTO activities (type, subject, description, dueDate, completed, contactId, dealId, ownerId, createdAt, completedAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

db.transaction(() => {
  const companies = [
    ['Acme Corp', 'Manufacturing', 'https://acme.example.com', '+1 555 0100', '1 Main St, Springfield', adminId],
    ['Globex', 'Technology', 'https://globex.example.com', '+1 555 0101', '42 Tech Ave, Metropolis', adminId],
    ['Initech', 'Software', 'https://initech.example.com', '+1 555 0102', '9 Office Park, Austin', salesId],
    ['Umbrella Health', 'Healthcare', 'https://umbrella.example.com', '+1 555 0103', '77 Raccoon Rd', salesId],
  ] as const;
  const companyIds = companies.map((c) => Number(insCompany.run(...c, now, now).lastInsertRowid));

  const contacts = [
    ['Wile', 'Coyote', 'wile@acme.example.com', '+1 555 0200', 'Purchasing Manager', companyIds[0], adminId],
    ['Hank', 'Scorpio', 'hank@globex.example.com', '+1 555 0201', 'CEO', companyIds[1], adminId],
    ['Peter', 'Gibbons', 'peter@initech.example.com', '+1 555 0202', 'Engineer', companyIds[2], salesId],
    ['Bill', 'Lumbergh', 'bill@initech.example.com', '+1 555 0203', 'VP', companyIds[2], salesId],
    ['Alice', 'Abernathy', 'alice@umbrella.example.com', '+1 555 0204', 'Director', companyIds[3], salesId],
  ] as const;
  const contactIds = contacts.map((c) => Number(insContact.run(...c, now, now).lastInsertRowid));

  // [title, value, stage, contact, company, owner, expected close, created (days ago), closed (days ago), source, loss reason]
  type SeedDeal = [string, number, string, number | null, number | null, number, string | null, number, number | null, string | null, string | null];
  const deals: SeedDeal[] = [
    ['Acme anvils bulk order', 12000, 'lead', contactIds[0], companyIds[0], adminId, inDays(30), 5, null, 'Web', null],
    ['Globex platform license', 48000, 'proposal', contactIds[1], companyIds[1], adminId, inDays(45), 21, null, 'Recomendación', null],
    ['Initech TPS migration', 23000, 'qualified', contactIds[2], companyIds[2], salesId, inDays(20), 12, null, 'Evento', null],
    ['Initech support renewal', 8000, 'won', contactIds[3], companyIds[2], salesId, inDays(-5), 40, 5, 'Recomendación', null],
    ['Umbrella lab equipment', 65000, 'negotiation', contactIds[4], companyIds[3], salesId, inDays(15), 34, null, 'Publicidad', null],
    ['Umbrella pilot', 5000, 'lost', contactIds[4], companyIds[3], salesId, inDays(-10), 28, 10, 'Llamada en frío', 'Precio'],
    // closed in earlier months, so the sales-by-month and conversion metrics have something to show
    ['Globex onboarding pack', 9000, 'won', contactIds[1], companyIds[1], adminId, null, 75, 48, 'Web', null],
    ['Acme maintenance contract', 15000, 'won', contactIds[0], companyIds[0], adminId, null, 95, 62, 'Recomendación', null],
    ['Initech training', 4000, 'won', contactIds[2], companyIds[2], salesId, null, 70, 41, 'Redes sociales', null],
    ['Hooli prototype', 18000, 'lost', null, null, adminId, null, 80, 52, 'Web', 'Eligió a la competencia'],
    ['Pied Piper licences', 7000, 'lost', null, null, salesId, null, 66, 33, 'Evento', 'Sin presupuesto'],
    ['Wonka samples', 3000, 'lost', null, null, salesId, null, 45, 20, 'Redes sociales', 'Sin respuesta'],
  ];
  const OPEN_PATH = ['lead', 'qualified', 'proposal', 'negotiation'];
  const dealIds = deals.map(([title, value, stage, contactId, companyId, ownerId, close, createdAgo, closedAgo, source, reason]) => {
    const created = ago(createdAgo);
    const closed = closedAgo === null ? null : ago(closedAgo);
    const id = Number(
      insDeal.run(title, value, 'USD', stage, contactId, companyId, ownerId, close, created, closed ?? created, closed, source ? optionId('lead_source', source) : null, reason ? optionId('loss_reason', reason) : null).lastInsertRowid,
    );
    // plausible journey through the stages, spread evenly between creation and now (or closing)
    const end = Date.parse(closed ?? new Date().toISOString());
    const steps = stage === 'won' ? OPEN_PATH.slice(0, 3) : stage === 'lost' ? OPEN_PATH.slice(0, 2) : OPEN_PATH.slice(0, OPEN_PATH.indexOf(stage) + 1);
    const finals = stage === 'won' || stage === 'lost' ? [stage] : [];
    const path = [...steps, ...finals];
    path.forEach((st, i) => {
      const at = new Date(Date.parse(created) + ((end - Date.parse(created)) * i) / Math.max(1, path.length - (finals.length ? 1 : 0)));
      insHistory.run(id, i === 0 ? null : path[i - 1], st, (i === path.length - 1 && closed ? new Date(closed) : at).toISOString(), ownerId);
    });
    return id;
  });

  const activities = [
    ['call', 'Intro call with Wile', 'Discuss bulk pricing', inDays(1), 0, contactIds[0], dealIds[0], adminId],
    ['meeting', 'Globex demo', 'Platform walkthrough', inDays(3), 0, contactIds[1], dealIds[1], adminId],
    ['email', 'Send TPS proposal', null, inDays(2), 0, contactIds[2], dealIds[2], salesId],
    ['task', 'Prepare Umbrella contract', 'Legal review needed', inDays(5), 0, contactIds[4], dealIds[4], salesId],
    ['note', 'Renewal signed', 'Customer happy with support', inDays(-5), 1, contactIds[3], dealIds[3], salesId],
  ] as const;
  for (const a of activities) insActivity.run(...a, now, a[4] ? now : null);
})();

console.log(`Seed completed (db: ${getDbPath()})`);
console.log('  admin@crm.local / Admin123!  (admin)');
console.log('  sales@crm.local / Sales123!  (sales)');
