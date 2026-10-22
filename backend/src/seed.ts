/* Seed script: `npm run seed`. Idempotent: upserts users, inserts sample data only if empty. */
import { getDbPath, loadEnv } from './config.js';

loadEnv();

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
  `INSERT INTO deals (title, value, currency, stage, contactId, companyId, ownerId, expectedCloseDate, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insActivity = db.prepare(
  `INSERT INTO activities (type, subject, description, dueDate, completed, contactId, dealId, ownerId, createdAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  const deals = [
    ['Acme anvils bulk order', 12000, 'lead', contactIds[0], companyIds[0], adminId, inDays(30)],
    ['Globex platform license', 48000, 'proposal', contactIds[1], companyIds[1], adminId, inDays(45)],
    ['Initech TPS migration', 23000, 'qualified', contactIds[2], companyIds[2], salesId, inDays(20)],
    ['Initech support renewal', 8000, 'won', contactIds[3], companyIds[2], salesId, inDays(-5)],
    ['Umbrella lab equipment', 65000, 'negotiation', contactIds[4], companyIds[3], salesId, inDays(15)],
    ['Umbrella pilot', 5000, 'lost', contactIds[4], companyIds[3], salesId, inDays(-10)],
  ] as const;
  const dealIds = deals.map(([title, value, stage, contactId, companyId, ownerId, close]) =>
    Number(insDeal.run(title, value, 'USD', stage, contactId, companyId, ownerId, close, now, now).lastInsertRowid),
  );

  const activities = [
    ['call', 'Intro call with Wile', 'Discuss bulk pricing', inDays(1), 0, contactIds[0], dealIds[0], adminId],
    ['meeting', 'Globex demo', 'Platform walkthrough', inDays(3), 0, contactIds[1], dealIds[1], adminId],
    ['email', 'Send TPS proposal', null, inDays(2), 0, contactIds[2], dealIds[2], salesId],
    ['task', 'Prepare Umbrella contract', 'Legal review needed', inDays(5), 0, contactIds[4], dealIds[4], salesId],
    ['note', 'Renewal signed', 'Customer happy with support', inDays(-5), 1, contactIds[3], dealIds[3], salesId],
  ] as const;
  for (const a of activities) insActivity.run(...a, now);
})();

console.log(`Seed completed (db: ${getDbPath()})`);
console.log('  admin@crm.local / Admin123!  (admin)');
console.log('  sales@crm.local / Sales123!  (sales)');
