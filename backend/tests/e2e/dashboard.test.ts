import { describe, it, expect, beforeAll } from 'vitest';
import { create } from './crudSuite';
import { api, auth, expectError, setupUsers, Session } from './helpers';

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

describe('Dashboard stats', () => {
  let admin: Session, sales1: Session, sales2: Session;

  beforeAll(async () => {
    ({ admin, sales1, sales2 } = await setupUsers());
    await create('/api/companies', sales1, { name: 'S1 Co' });
    await create('/api/companies', sales2, { name: 'S2 Co' });
    await create('/api/contacts', sales1, { firstName: 'S1', lastName: 'C' });
    await create('/api/deals', sales1, { title: 'open1', value: 100, stage: 'lead' });
    await create('/api/deals', sales1, { title: 'open2', value: 200, stage: 'negotiation' });
    await create('/api/deals', sales1, { title: 'won1', value: 1000, stage: 'won' });
    await create('/api/deals', sales1, { title: 'lost1', value: 5000, stage: 'lost' });
    await create('/api/deals', sales2, { title: 's2won', value: 300, stage: 'won' });
    await create('/api/activities', sales1, {
      type: 'call', subject: 'Future call', dueDate: new Date(Date.now() + 86400000).toISOString(),
    });
  });

  it('[DB-04] requires auth', async () => {
    const r = await (await api()).get('/api/dashboard/stats');
    expectError(r, 401);
  });

  it('[DB-01] returns contract shape', async () => {
    const r = await (await api()).get('/api/dashboard/stats').set(auth(sales1));
    expect(r.status).toBe(200);
    const { totals, dealsByStage, upcomingActivities } = r.body;
    for (const k of ['companies', 'contacts', 'deals', 'openDealsValue', 'wonDealsValue']) {
      expect(typeof totals[k], k).toBe('number');
    }
    expect(Array.isArray(dealsByStage)).toBe(true);
    for (const s of dealsByStage) {
      expect(STAGES).toContain(s.stage);
      expect(typeof s.count).toBe('number');
      expect(typeof s.value).toBe('number');
    }
    expect(Array.isArray(upcomingActivities)).toBe(true);
  });

  it('[DB-02][DB-03] sales sees only own totals with correct values', async () => {
    const r = await (await api()).get('/api/dashboard/stats').set(auth(sales1));
    const { totals, dealsByStage, upcomingActivities } = r.body;
    expect(totals.companies).toBe(1);
    expect(totals.contacts).toBe(1);
    expect(totals.deals).toBe(4);
    expect(totals.openDealsValue).toBe(300);
    expect(totals.wonDealsValue).toBe(1000);
    const won = dealsByStage.find((s: any) => s.stage === 'won');
    expect(won).toMatchObject({ count: 1, value: 1000 });
    const lead = dealsByStage.find((s: any) => s.stage === 'lead');
    expect(lead).toMatchObject({ count: 1, value: 100 });
    expect(upcomingActivities.some((a: any) => a.subject === 'Future call')).toBe(true);
  });

  it('[DB-03] sales2 does not see sales1 data', async () => {
    const r = await (await api()).get('/api/dashboard/stats').set(auth(sales2));
    expect(r.body.totals.deals).toBe(1);
    expect(r.body.totals.wonDealsValue).toBe(300);
    expect(r.body.upcomingActivities.length).toBe(0);
  });

  it('[DB-03] admin sees global totals', async () => {
    const r = await (await api()).get('/api/dashboard/stats').set(auth(admin));
    expect(r.body.totals.companies).toBe(2);
    expect(r.body.totals.deals).toBe(5);
    expect(r.body.totals.openDealsValue).toBe(300);
    expect(r.body.totals.wonDealsValue).toBe(1300);
  });
});
