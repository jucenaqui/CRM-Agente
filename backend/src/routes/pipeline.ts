import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../lib/auth.js';
import { parseIdParam } from '../lib/crud.js';
import { badRequest } from '../lib/errors.js';
import {
  OPTION_KINDS,
  createOption,
  createStage,
  deleteOption,
  deleteStage,
  getStages,
  listOptions,
  renameOption,
  reorderOptions,
  reorderStages,
  updateStage,
  type OptionKind,
} from '../lib/pipeline.js';
import { reqText, validate } from '../lib/validation.js';

/**
 * Pipeline configuration. Everyone can read it (the screens need the stage names); only admins
 * change it. Mounted at /api/pipeline behind requireAuth.
 */
const router = Router();
const admin = requireRole('admin');

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Debe ser un color #RRGGBB');
const probability = z.number().int().min(0).max(100);
const kind = z.enum(['open', 'won', 'lost']);

// Everything the screens (and the assistant) need to know about how this CRM sells, in one call.
router.get('/', (_req, res) => {
  res.json({ stages: getStages(), leadSources: listOptions('lead_source'), lossReasons: listOptions('loss_reason') });
});

// ---- stages ----

router.get('/stages', (_req, res) => {
  res.json({ data: getStages() });
});

const createStageSchema = z.strictObject({ name: reqText(60), probability: probability.optional(), kind: kind.optional(), color: color.optional() });
const updateStageSchema = z.strictObject({ name: reqText(60), probability, kind, color }).partial();
const orderSchema = z.strictObject({ ids: z.array(z.number().int().positive()).min(1).max(200) });

router.post('/stages', admin, (req, res) => {
  res.status(201).json(createStage(validate(createStageSchema, req.body ?? {})));
});

// Registered before '/stages/:id' so "order" is not read as an id.
router.put('/stages/order', admin, (req, res) => {
  res.json({ data: reorderStages(validate(orderSchema, req.body ?? {}).ids) });
});

router.patch('/stages/:id', admin, (req, res) => {
  res.json(updateStage(parseIdParam(req.params.id), validate(updateStageSchema, req.body ?? {})));
});

router.delete('/stages/:id', admin, (req, res) => {
  const raw = req.query.moveTo;
  const moveTo = raw === undefined || raw === '' ? undefined : Number(raw);
  if (moveTo !== undefined && !Number.isInteger(moveTo)) throw badRequest('moveTo debe ser el id de una etapa');
  deleteStage(parseIdParam(req.params.id), moveTo);
  res.status(204).end();
});

// ---- lead sources / loss reasons ----

const optionKind = (raw: unknown): OptionKind => {
  if (!OPTION_KINDS.includes(raw as OptionKind)) throw badRequest(`Tipo de lista no válido. Permitidos: ${OPTION_KINDS.join(', ')}`);
  return raw as OptionKind;
};
const nameSchema = z.strictObject({ name: reqText(80) });

router.get('/options/:kind', (req, res) => {
  const k = optionKind(req.params.kind);
  // Archived ones are only needed to show the name of old deals.
  res.json({ data: listOptions(k, req.query.includeArchived === '1' || req.query.includeArchived === 'true') });
});

router.post('/options/:kind', admin, (req, res) => {
  res.status(201).json(createOption(optionKind(req.params.kind), validate(nameSchema, req.body ?? {}).name));
});

router.put('/options/:kind/order', admin, (req, res) => {
  res.json({ data: reorderOptions(optionKind(req.params.kind), validate(orderSchema, req.body ?? {}).ids) });
});

router.patch('/options/:kind/:id', admin, (req, res) => {
  optionKind(req.params.kind);
  res.json(renameOption(parseIdParam(req.params.id), validate(nameSchema, req.body ?? {}).name));
});

router.delete('/options/:kind/:id', admin, (req, res) => {
  optionKind(req.params.kind);
  const result = deleteOption(parseIdParam(req.params.id));
  res.status(200).json({ result }); // 'deleted' | 'archived' (archived when deals already use it)
});

export default router;
