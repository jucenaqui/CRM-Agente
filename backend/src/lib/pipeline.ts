import { getDb, nowIso } from '../db.js';
import { badRequest, conflict, HttpError, notFound } from './errors.js';

/**
 * The sales pipeline of one installation: its stages (editable, with defaults), and the two
 * lookup lists deals use for reporting (lead sources, loss reasons).
 *
 * Stage `key` is a stable identifier (what the API, integrations and the AI use); `name` is what
 * people see and can be renamed freely. Every pipeline always has at least one open stage, one
 * "won" stage and one "lost" stage, because the metrics (win rate, sales, loss reasons) need them.
 */
export type StageKind = 'open' | 'won' | 'lost';

export interface Stage {
  id: number;
  key: string;
  name: string;
  position: number;
  probability: number;
  kind: StageKind;
  color: string;
}

const STAGE_COLS = 'id, key, name, position, probability, kind, color';
const PALETTE = ['#868e96', '#1c7ed6', '#7048e8', '#f08c00', '#0ca678', '#d6336c', '#15aabf', '#e8590c', '#5c7cfa', '#82c91e'];

export const getStages = (): Stage[] =>
  getDb().prepare(`SELECT ${STAGE_COLS} FROM pipeline_stages ORDER BY position, id`).all() as unknown as Stage[];

export const stageKeys = (): string[] => getStages().map((s) => s.key);

export const getStageByKey = (key: string): Stage | undefined =>
  getDb().prepare(`SELECT ${STAGE_COLS} FROM pipeline_stages WHERE key = ?`).get(key) as Stage | undefined;

export const getStageById = (id: number): Stage | undefined =>
  getDb().prepare(`SELECT ${STAGE_COLS} FROM pipeline_stages WHERE id = ?`).get(id) as Stage | undefined;

export const kindOfStage = (key: string): StageKind | undefined => getStageByKey(key)?.kind;

/** Stage new deals start in: the first open stage. */
export const defaultStageKey = (): string =>
  (getDb().prepare("SELECT key FROM pipeline_stages WHERE kind = 'open' ORDER BY position, id LIMIT 1").get() as { key: string }).key;

export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'etapa';
}

function uniqueKey(name: string): string {
  const base = slugify(name);
  let key = base;
  for (let i = 2; getStageByKey(key); i++) key = `${base}-${i}`;
  return key;
}

/** Open stages first, then won/lost; contiguous positions starting at 1. */
function normalizeOrder(): void {
  const db = getDb();
  const rows = db.prepare('SELECT id, kind FROM pipeline_stages ORDER BY (kind != \'open\'), position, id').all() as { id: number; kind: StageKind }[];
  const upd = db.prepare('UPDATE pipeline_stages SET position = ? WHERE id = ?');
  rows.forEach((r, i) => upd.run(i + 1, r.id));
}

function countKind(kind: StageKind, exceptId?: number): number {
  return (
    getDb()
      .prepare('SELECT COUNT(*) AS n FROM pipeline_stages WHERE kind = ? AND id != ?')
      .get(kind, exceptId ?? -1) as { n: number }
  ).n;
}

const KIND_LABEL: Record<StageKind, string> = { open: 'abierta', won: 'ganada', lost: 'perdida' };

function assertNameFree(name: string, exceptId?: number): void {
  const dup = getDb()
    .prepare('SELECT id FROM pipeline_stages WHERE name = ? COLLATE NOCASE AND id != ?')
    .get(name, exceptId ?? -1);
  if (dup) throw conflict(`Ya existe una etapa llamada «${name}»`, 'STAGE_NAME_TAKEN');
}

export interface StageInput {
  name: string;
  probability?: number;
  kind?: StageKind;
  color?: string;
}

export function createStage(input: StageInput): Stage {
  const kind = input.kind ?? 'open';
  assertNameFree(input.name);
  const db = getDb();
  const probability = kind === 'won' ? 100 : kind === 'lost' ? 0 : (input.probability ?? 50);
  const color = input.color ?? PALETTE[getStages().length % PALETTE.length];
  const key = uniqueKey(input.name);
  db.transaction(() => {
    // New open stage goes after the last open one; won/lost go at the end.
    db.prepare('INSERT INTO pipeline_stages (key, name, position, probability, kind, color, createdAt) VALUES (?, ?, 0, ?, ?, ?, ?)').run(
      key,
      input.name,
      probability,
      kind,
      color,
      nowIso(),
    );
    if (kind === 'open') {
      const lastOpen = (db.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM pipeline_stages WHERE kind = 'open' AND key != ?").get(key) as { p: number }).p;
      db.prepare('UPDATE pipeline_stages SET position = position + 1 WHERE kind != \'open\' AND position > ?').run(lastOpen);
      db.prepare('UPDATE pipeline_stages SET position = ? WHERE key = ?').run(lastOpen + 1, key);
    } else {
      const max = (db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM pipeline_stages WHERE key != ?').get(key) as { p: number }).p;
      db.prepare('UPDATE pipeline_stages SET position = ? WHERE key = ?').run(max + 1, key);
    }
    normalizeOrder();
  })();
  return getStageByKey(key)!;
}

export function updateStage(id: number, patch: Partial<StageInput>): Stage {
  const cur = getStageById(id);
  if (!cur) throw notFound('Etapa no encontrada');
  if (patch.name !== undefined) assertNameFree(patch.name, id);
  const kind = patch.kind ?? cur.kind;
  if (kind !== cur.kind && countKind(cur.kind, id) === 0) {
    throw conflict(`Debe quedar al menos una etapa ${KIND_LABEL[cur.kind]}`, 'LAST_OF_KIND');
  }
  const probability = kind === 'won' ? 100 : kind === 'lost' ? 0 : (patch.probability ?? cur.probability);
  getDb().transaction(() => {
    getDb()
      .prepare('UPDATE pipeline_stages SET name = ?, probability = ?, kind = ?, color = ? WHERE id = ?')
      .run(patch.name ?? cur.name, probability, kind, patch.color ?? cur.color, id);
    if (kind !== cur.kind) {
      // deals sitting in a stage whose meaning changed: keep closedAt/lostReason consistent
      const deals = getDb().prepare('SELECT id, closedAt FROM deals WHERE stage = ?').all(cur.key) as { id: number; closedAt: string | null }[];
      const now = nowIso();
      for (const d of deals) {
        getDb()
          .prepare('UPDATE deals SET closedAt = ?, lostReasonId = CASE WHEN ? = \'lost\' THEN lostReasonId ELSE NULL END WHERE id = ?')
          .run(kind === 'open' ? null : (d.closedAt ?? now), kind, d.id);
      }
    }
    normalizeOrder();
  })();
  return getStageById(id)!;
}

/** `ids` must be every stage id, with all open stages before the won/lost ones. */
export function reorderStages(ids: number[]): Stage[] {
  const all = getStages();
  const known = new Set(all.map((s) => s.id));
  if (ids.length !== all.length || new Set(ids).size !== ids.length || !ids.every((i) => known.has(i))) {
    throw badRequest('El orden debe incluir todas las etapas, una sola vez cada una');
  }
  const byId = new Map(all.map((s) => [s.id, s]));
  const kinds = ids.map((i) => byId.get(i)!.kind);
  const firstClosed = kinds.findIndex((k) => k !== 'open');
  if (firstClosed !== -1 && kinds.slice(firstClosed).some((k) => k === 'open')) {
    throw badRequest('Las etapas abiertas deben ir antes que las ganadas y perdidas');
  }
  const upd = getDb().prepare('UPDATE pipeline_stages SET position = ? WHERE id = ?');
  getDb().transaction(() => ids.forEach((id, i) => upd.run(i + 1, id)))();
  return getStages();
}

export function deleteStage(id: number, moveToId?: number): { moved: number } {
  const cur = getStageById(id);
  if (!cur) throw notFound('Etapa no encontrada');
  if (countKind(cur.kind, id) === 0) {
    throw conflict(`Debe quedar al menos una etapa ${KIND_LABEL[cur.kind]}`, 'LAST_OF_KIND');
  }
  const inUse = (getDb().prepare('SELECT COUNT(*) AS n FROM deals WHERE stage = ?').get(cur.key) as { n: number }).n;
  let target: Stage | undefined;
  if (inUse > 0) {
    if (moveToId === undefined) {
      throw new HttpError(409, 'STAGE_IN_USE', `Hay ${inUse} deal(s) en la etapa «${cur.name}»: indica a qué etapa moverlos`, { deals: inUse });
    }
    target = getStageById(moveToId);
    if (!target || target.id === id) throw badRequest('La etapa de destino no es válida');
  }
  getDb().transaction(() => {
    if (target) {
      const deals = getDb().prepare('SELECT id FROM deals WHERE stage = ?').all(cur.key) as { id: number }[];
      for (const d of deals) moveDealToStage(d.id, target.key, null);
    }
    getDb().prepare('DELETE FROM pipeline_stages WHERE id = ?').run(id);
    normalizeOrder();
  })();
  return { moved: inUse };
}

// ---- how a stage change affects a deal -------------------------------------------------------

export interface StageEffects {
  closedAt: string | null;
  /** null clears the loss reason (the deal is no longer lost); undefined leaves it as sent. */
  lostReasonId?: null;
}

/**
 * Derived fields for a deal that is (or becomes) in `toKey`: the real close date is set when the
 * deal enters a won/lost stage (kept while it moves between stages of the same closed kind) and
 * cleared when it is reopened; the loss reason only makes sense on lost deals.
 */
export function stageEffects(existing: { stage: string; closedAt: string | null } | null, toKey: string): StageEffects {
  const to = kindOfStage(toKey) ?? 'open';
  if (to === 'open') return { closedAt: null, lostReasonId: null };
  const from = existing ? kindOfStage(existing.stage) : undefined;
  const closedAt = existing?.closedAt && from === to ? existing.closedAt : nowIso();
  return to === 'lost' ? { closedAt } : { closedAt, lostReasonId: null };
}

export function recordStageChange(dealId: number, from: string | null, to: string, userId: number | null): void {
  getDb()
    .prepare('INSERT INTO deal_stage_history (dealId, fromStage, toStage, changedAt, changedBy) VALUES (?, ?, ?, ?, ?)')
    .run(dealId, from, to, nowIso(), userId);
}

/** Moves a deal outside of the normal API path (stage deleted/merged): keeps history and close dates right. */
export function moveDealToStage(dealId: number, toKey: string, userId: number | null): void {
  const db = getDb();
  const d = db.prepare('SELECT stage, closedAt FROM deals WHERE id = ?').get(dealId) as { stage: string; closedAt: string | null } | undefined;
  if (!d || d.stage === toKey) return;
  const fx = stageEffects(d, toKey);
  db.prepare('UPDATE deals SET stage = ?, closedAt = ?, lostReasonId = CASE WHEN ? THEN NULL ELSE lostReasonId END, updatedAt = ? WHERE id = ?').run(
    toKey,
    fx.closedAt,
    fx.lostReasonId === null ? 1 : 0,
    nowIso(),
    dealId,
  );
  recordStageChange(dealId, d.stage, toKey, userId);
}

// ---- lookup lists: lead sources and loss reasons ---------------------------------------------

export type OptionKind = 'lead_source' | 'loss_reason';
export const OPTION_KINDS: readonly OptionKind[] = ['lead_source', 'loss_reason'];

export interface CrmOption {
  id: number;
  kind: OptionKind;
  name: string;
  position: number;
  archived: boolean;
}

const COLUMN: Record<OptionKind, 'sourceId' | 'lostReasonId'> = { lead_source: 'sourceId', loss_reason: 'lostReasonId' };

interface OptionRow {
  id: number;
  kind: OptionKind;
  name: string;
  position: number;
  archivedAt: string | null;
}
const toOption = (r: OptionRow): CrmOption => ({ id: r.id, kind: r.kind, name: r.name, position: r.position, archived: r.archivedAt !== null });

export function listOptions(kind: OptionKind, includeArchived = false): CrmOption[] {
  const rows = getDb()
    .prepare(`SELECT id, kind, name, position, archivedAt FROM crm_options WHERE kind = ? ${includeArchived ? '' : 'AND archivedAt IS NULL'} ORDER BY position, id`)
    .all(kind) as unknown as OptionRow[];
  return rows.map(toOption);
}

export const getOption = (id: number): CrmOption | undefined => {
  const r = getDb().prepare('SELECT id, kind, name, position, archivedAt FROM crm_options WHERE id = ?').get(id) as OptionRow | undefined;
  return r ? toOption(r) : undefined;
};

/** True when `id` is an active (not archived) option of that kind: what a deal may point to. */
export const isActiveOption = (kind: OptionKind, id: number): boolean => {
  const o = getOption(id);
  return !!o && o.kind === kind && !o.archived;
};

function assertOptionNameFree(kind: OptionKind, name: string, exceptId?: number): void {
  const dup = getDb()
    .prepare('SELECT id FROM crm_options WHERE kind = ? AND name = ? COLLATE NOCASE AND archivedAt IS NULL AND id != ?')
    .get(kind, name, exceptId ?? -1);
  if (dup) throw conflict(`Ya existe «${name}»`, 'OPTION_NAME_TAKEN');
}

export function createOption(kind: OptionKind, name: string): CrmOption {
  assertOptionNameFree(kind, name);
  const max = (getDb().prepare('SELECT COALESCE(MAX(position), 0) AS p FROM crm_options WHERE kind = ?').get(kind) as { p: number }).p;
  const info = getDb()
    .prepare('INSERT INTO crm_options (kind, name, position, createdAt) VALUES (?, ?, ?, ?)')
    .run(kind, name, max + 1, nowIso());
  return getOption(Number(info.lastInsertRowid))!;
}

export function renameOption(id: number, name: string): CrmOption {
  const o = getOption(id);
  if (!o || o.archived) throw notFound('Opción no encontrada');
  assertOptionNameFree(o.kind, name, id);
  getDb().prepare('UPDATE crm_options SET name = ? WHERE id = ?').run(name, id);
  return getOption(id)!;
}

export function reorderOptions(kind: OptionKind, ids: number[]): CrmOption[] {
  const current = listOptions(kind);
  const known = new Set(current.map((o) => o.id));
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((i) => known.has(i))) {
    throw badRequest('El orden debe incluir todas las opciones, una sola vez cada una');
  }
  const upd = getDb().prepare('UPDATE crm_options SET position = ? WHERE id = ?');
  getDb().transaction(() => ids.forEach((id, i) => upd.run(i + 1, id)))();
  return listOptions(kind);
}

/**
 * Deletes an option nobody uses; one that deals already point to is archived instead (hidden from
 * the pickers, but old deals and the reports keep showing its name).
 */
export function deleteOption(id: number): 'deleted' | 'archived' {
  const o = getOption(id);
  if (!o || o.archived) throw notFound('Opción no encontrada');
  const used = (getDb().prepare(`SELECT COUNT(*) AS n FROM deals WHERE ${COLUMN[o.kind]} = ?`).get(id) as { n: number }).n;
  if (used > 0) {
    getDb().prepare('UPDATE crm_options SET archivedAt = ? WHERE id = ?').run(nowIso(), id);
    return 'archived';
  }
  getDb().prepare('DELETE FROM crm_options WHERE id = ?').run(id);
  return 'deleted';
}
