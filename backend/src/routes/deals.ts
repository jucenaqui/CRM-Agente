import { z } from 'zod';
import { getDb } from '../db.js';
import { currentUser } from '../lib/auth.js';
import { buildCrud, parseIdParam, type Row } from '../lib/crud.js';
import { unprocessable } from '../lib/errors.js';
import { defaultStageKey, isActiveOption, kindOfStage, recordStageChange, stageEffects, stageKeys } from '../lib/pipeline.js';
import { money, optDate, optId, reqText, validate } from '../lib/validation.js';

/** Valid at the moment of the request: the pipeline's stages are editable. */
const stageKey = z.string().refine((k) => stageKeys().includes(k), 'Etapa desconocida');

const fields = {
  title: reqText(200),
  value: money(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 code'),
  stage: stageKey,
  contactId: optId(),
  companyId: optId(),
  expectedCloseDate: optDate(),
  sourceId: optId(),
  lostReasonId: optId(),
};

function checkOptions(data: Row): void {
  if (data.sourceId != null && !isActiveOption('lead_source', Number(data.sourceId))) {
    throw unprocessable('Referenced sourceId does not exist', 'INVALID_REFERENCE', { field: 'sourceId' });
  }
  if (data.lostReasonId != null && !isActiveOption('loss_reason', Number(data.lostReasonId))) {
    throw unprocessable('Referenced lostReasonId does not exist', 'INVALID_REFERENCE', { field: 'lostReasonId' });
  }
}

export const deals = buildCrud({
  table: 'deals',
  searchColumns: ['title'],
  sortColumns: ['title', 'value', 'stage', 'expectedCloseDate', 'closedAt', 'createdAt', 'updatedAt'],
  filters: [
    { param: 'stage', column: 'stage', kind: 'enum', values: stageKeys },
    { param: 'companyId', column: 'companyId', kind: 'id' },
    { param: 'contactId', column: 'contactId', kind: 'id' },
    { param: 'sourceId', column: 'sourceId', kind: 'id' },
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
  defaults: () => ({ value: 0, currency: 'USD', stage: defaultStageKey() }),
  hasUpdatedAt: true,

  // closedAt is never sent by clients: it follows the stage (set on entering won/lost, cleared on reopening).
  onCreate: (data) => {
    checkOptions(data);
    const fx = stageEffects(null, String(data.stage));
    return { closedAt: fx.closedAt, ...(fx.lostReasonId === null ? { lostReasonId: null } : {}) };
  },
  onUpdate: (data, existing) => {
    checkOptions(data);
    const stage = typeof data.stage === 'string' ? data.stage : String(existing.stage);
    const out: Row = {};
    if (stage !== existing.stage) {
      const fx = stageEffects({ stage: String(existing.stage), closedAt: (existing.closedAt as string | null) ?? null }, stage);
      out.closedAt = fx.closedAt;
      if (fx.lostReasonId === null) out.lostReasonId = null;
    } else if (kindOfStage(stage) !== 'lost' && data.lostReasonId != null) {
      out.lostReasonId = null; // a loss reason only makes sense on lost deals
    }
    return out;
  },
  afterCreate: (row, req) => recordStageChange(Number(row.id), null, String(row.stage), currentUser(req).id),
  afterUpdate: (before, after, req) => {
    if (before.stage !== after.stage) recordStageChange(Number(after.id), String(before.stage), String(after.stage), currentUser(req).id);
  },
});

const stageSchema = z.strictObject({ stage: stageKey, lostReasonId: optId() });

deals.router.patch('/:id/stage', (req, res) => {
  const id = parseIdParam(req.params.id);
  deals.findOwned(req, id);
  const { stage, lostReasonId } = validate(stageSchema, req.body ?? {});
  res.json(deals.update(req, id, { stage, ...(lostReasonId !== undefined ? { lostReasonId } : {}) }));
});

/** Stage changes of a deal, oldest first. */
deals.router.get('/:id/history', (req, res) => {
  const id = parseIdParam(req.params.id);
  deals.findOwned(req, id);
  const rows = getDb()
    .prepare(
      `SELECT h.id, h.fromStage, h.toStage, h.changedAt, u.name AS changedByName
       FROM deal_stage_history h LEFT JOIN users u ON u.id = h.changedBy
       WHERE h.dealId = ? ORDER BY h.id`,
    )
    .all(id);
  res.json({ data: rows });
});

export default deals.router;
