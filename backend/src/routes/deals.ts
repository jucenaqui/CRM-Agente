import { z } from 'zod';
import { buildCrud, parseIdParam } from '../lib/crud.js';
import { money, optDate, optId, reqText, validate } from '../lib/validation.js';

export const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export type Stage = (typeof STAGES)[number];

const fields = {
  title: reqText(200),
  value: money(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 code'),
  stage: z.enum(STAGES),
  contactId: optId(),
  companyId: optId(),
  expectedCloseDate: optDate(),
};

export const deals = buildCrud({
  table: 'deals',
  searchColumns: ['title'],
  sortColumns: ['title', 'value', 'stage', 'expectedCloseDate', 'createdAt', 'updatedAt'],
  filters: [
    { param: 'stage', column: 'stage', kind: 'enum', values: STAGES },
    { param: 'companyId', column: 'companyId', kind: 'id' },
    { param: 'contactId', column: 'contactId', kind: 'id' },
  ],
  refs: [
    { field: 'contactId', table: 'contacts' },
    { field: 'companyId', table: 'companies' },
  ],
  createSchema: z.strictObject({
    ...fields,
    value: fields.value.optional(),
    currency: fields.currency.optional(),
    stage: fields.stage.optional(),
  }),
  updateSchema: z.strictObject(fields).partial(),
  defaults: { value: 0, currency: 'USD', stage: 'lead' },
  hasUpdatedAt: true,
});

const stageSchema = z.strictObject({ stage: z.enum(STAGES) });

deals.router.patch('/:id/stage', (req, res) => {
  const id = parseIdParam(req.params.id);
  deals.findOwned(req, id);
  const { stage } = validate(stageSchema, req.body ?? {});
  res.json(deals.update(req, id, { stage }));
});

export default deals.router;
