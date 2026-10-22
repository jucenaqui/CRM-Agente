import { z } from 'zod';
import { buildCrud, type Row } from '../lib/crud.js';
import { nowIso } from '../db.js';
import { boolish, optDate, optId, optText, reqText } from '../lib/validation.js';

export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'task', 'note'] as const;

const fields = {
  type: z.enum(ACTIVITY_TYPES),
  subject: reqText(200),
  description: optText(5000),
  dueDate: optDate(),
  completed: boolish(),
  contactId: optId(),
  dealId: optId(),
};

export const mapActivity = (row: Row): Row => ({ ...row, completed: Boolean(row.completed) });

export const activities = buildCrud({
  table: 'activities',
  searchColumns: ['subject', 'description'],
  sortColumns: ['subject', 'type', 'dueDate', 'completed', 'createdAt'],
  filters: [
    { param: 'contactId', column: 'contactId', kind: 'id' },
    { param: 'dealId', column: 'dealId', kind: 'id' },
    { param: 'completed', column: 'completed', kind: 'bool' },
    { param: 'type', column: 'type', kind: 'enum', values: ACTIVITY_TYPES },
  ],
  refs: [
    { field: 'contactId', table: 'contacts' },
    { field: 'dealId', table: 'deals' },
  ],
  createSchema: z.strictObject({ ...fields, completed: fields.completed.optional() }),
  updateSchema: z.strictObject(fields).partial(),
  defaults: { completed: false },
  hasUpdatedAt: false,
  mapRow: mapActivity,
  // completedAt lets the dashboard count what was done in a period; it follows `completed`.
  onCreate: (data) => (data.completed ? { completedAt: nowIso() } : {}),
  onUpdate: (data, existing) => {
    if (data.completed === undefined || Boolean(data.completed) === Boolean(existing.completed)) return {};
    return { completedAt: data.completed ? nowIso() : null };
  },
});

export default activities.router;
