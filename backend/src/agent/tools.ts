import type Anthropic from '@anthropic-ai/sdk';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createCoreApp } from '../core.js';
import { ACTIVITY_TYPES } from '../routes/activities.js';
import { PERIODS } from '../lib/metrics.js';
import { getOption, getStageByKey } from '../lib/pipeline.js';

type Tool = Anthropic.Beta.BetaTool;
type JsonSchema = Tool['input_schema'];

const ENTITIES = ['companies', 'contacts', 'deals', 'activities', 'users'] as const;
type Entity = (typeof ENTITIES)[number];

const id = (description: string) => ({ type: 'integer', minimum: 1, description });
const str = (description: string) => ({ type: 'string', description });
const nullableStr = (description: string) => ({ type: ['string', 'null'], description });
const nullableId = (description: string) => ({ type: ['integer', 'null'], minimum: 1, description });

const companyFields = {
  name: str('Nombre de la empresa'),
  industry: nullableStr('Sector'),
  website: nullableStr('Sitio web (se acepta "acme.com")'),
  phone: nullableStr('Teléfono'),
  address: nullableStr('Dirección'),
};
const contactFields = {
  firstName: str('Nombre'),
  lastName: str('Apellidos'),
  email: nullableStr('Email'),
  phone: nullableStr('Teléfono'),
  position: nullableStr('Cargo'),
  companyId: nullableId('Empresa a la que pertenece'),
};
const dealFields = {
  title: str('Título del deal'),
  value: { type: 'number', minimum: 0, description: 'Importe' },
  currency: str('Moneda ISO 4217 de 3 letras, p. ej. USD, EUR, COP'),
  stage: { type: 'string', description: 'Clave de la etapa del embudo. Las etapas las define cada cliente: consúltalas con get_pipeline' },
  contactId: nullableId('Contacto asociado'),
  companyId: nullableId('Empresa asociada'),
  expectedCloseDate: nullableStr('Fecha prevista de cierre, ISO 8601'),
  sourceId: nullableId('Origen del lead (id de la lista de get_pipeline)'),
  lostReasonId: nullableId('Motivo de pérdida (id de la lista de get_pipeline). Sólo para deals en una etapa perdida'),
};
const activityFields = {
  type: { type: 'string', enum: ACTIVITY_TYPES, description: 'Tipo de actividad' },
  subject: str('Asunto'),
  description: nullableStr('Descripción o notas'),
  dueDate: nullableStr('Fecha y hora de vencimiento, ISO 8601'),
  completed: { type: 'boolean', description: 'Si está completada' },
  contactId: nullableId('Contacto asociado'),
  dealId: nullableId('Deal asociado'),
};
const userFields = {
  name: str('Nombre'),
  email: str('Email (identificador de acceso)'),
  password: str('Contraseña, mínimo 8 caracteres'),
  role: { type: 'string', enum: ['admin', 'sales'], description: 'Rol' },
};

const object = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

interface ToolSpec {
  tool: Tool;
  /** Entity whose data this tool changes (the UI refreshes it), if any. */
  mutates?: Entity | 'any';
  toRequest: (input: Record<string, unknown>) => ApiRequest;
}

interface ApiRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
}

const ENTITY_LABEL: Record<Entity, string> = {
  companies: 'empresa',
  contacts: 'contacto',
  deals: 'deal',
  activities: 'actividad',
  users: 'usuario',
};

const SINGULAR: Record<'companies' | 'contacts' | 'deals' | 'activities' | 'users', string> = {
  companies: 'company',
  contacts: 'contact',
  deals: 'deal',
  activities: 'activity',
  users: 'user',
};

function createAndUpdate(
  entity: Entity,
  fields: Record<string, unknown>,
  required: string[],
  note = '',
): ToolSpec[] {
  const label = ENTITY_LABEL[entity];
  const singular = SINGULAR[entity];
  return [
    {
      tool: {
        name: `create_${singular}`,
        description: `Crea un registro de ${label}.${note}`,
        input_schema: object(fields, required),
      },
      mutates: entity,
      toRequest: (input) => ({ method: 'POST', url: `/api/${entity}`, body: input }),
    },
    {
      tool: {
        name: `update_${singular}`,
        description: `Modifica un registro de ${label}. Envía sólo los campos que cambian; null vacía un campo opcional.${note}`,
        input_schema: object({ id: id(`Id de la ${label}`), ...fields }, ['id']),
      },
      mutates: entity,
      toRequest: ({ id: recordId, ...data }) => ({
        method: 'PATCH',
        url: `/api/${entity}/${recordId}`,
        body: data,
      }),
    },
  ];
}

const SPECS: ToolSpec[] = [
  {
    tool: {
      name: 'get_current_user',
      description: 'Devuelve el usuario con el que estás actuando (nombre, email, rol).',
      input_schema: object({}),
    },
    toRequest: () => ({ method: 'GET', url: '/api/auth/me' }),
  },
  {
    tool: {
      name: 'get_dashboard',
      description:
        'Resumen del CRM: totales, valor abierto y ganado, deals por etapa y próximas actividades. Es la forma más barata de responder preguntas de conjunto.',
      input_schema: object({}),
    },
    toRequest: () => ({ method: 'GET', url: '/api/dashboard/stats' }),
  },
  {
    tool: {
      name: 'get_pipeline',
      description:
        'Configuración de ventas de este CRM: las etapas del embudo (clave, nombre, tipo abierta/ganada/perdida, probabilidad), los orígenes de lead y los motivos de pérdida, con sus ids. Consúltala antes de mover un deal de etapa o de asignar un origen o un motivo de pérdida.',
      input_schema: object({}),
    },
    toRequest: () => ({ method: 'GET', url: '/api/pipeline' }),
  },
  {
    tool: {
      name: 'get_metrics',
      description:
        'Métricas de ventas de un periodo: ganado y perdido, tasa de conversión, ticket medio, ciclo de venta en días, pronóstico ponderado por etapa, ventas por mes, embudo con conversión y días por etapa, rendimiento por origen, motivos de pérdida, deals estancados, actividades y (para administradores) por vendedor. Úsala para preguntas de rendimiento («¿cómo voy?», «¿cuánto cerré este trimestre?»).',
      input_schema: object({ period: { type: 'string', enum: PERIODS, description: 'Por defecto 90d' } }),
    },
    toRequest: ({ period }) => ({ method: 'GET', url: `/api/dashboard/metrics${period ? `?period=${String(period)}` : ''}` }),
  },
  {
    tool: {
      name: 'list_records',
      description:
        'Lista y busca registros de una entidad, paginado. Devuelve {data, total, page, pageSize}. ' +
        'Úsalo también para encontrar el id de un registro a partir de su nombre. ' +
        'Campos de orden: companies(name, industry, createdAt, updatedAt); contacts(firstName, lastName, email, position, createdAt, updatedAt); ' +
        'deals(title, value, stage, expectedCloseDate, closedAt, createdAt, updatedAt); activities(subject, type, dueDate, completed, createdAt); users(name, email, role, createdAt). ' +
        'users sólo está disponible para administradores.',
      input_schema: object(
        {
          entity: { type: 'string', enum: ENTITIES },
          search: str('Texto a buscar (nombre, título, asunto, email...)'),
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, description: 'Por defecto 20, máximo 100' },
          sort: str('Campo de orden (ver descripción)'),
          order: { type: 'string', enum: ['asc', 'desc'] },
          companyId: id('Filtra contactos o deals por empresa'),
          contactId: id('Filtra deals o actividades por contacto'),
          dealId: id('Filtra actividades por deal'),
          stage: { type: 'string', description: 'Filtra deals por clave de etapa (ver get_pipeline)' },
          sourceId: id('Filtra deals por origen del lead'),
          completed: { type: 'boolean', description: 'Filtra actividades completadas o pendientes' },
        },
        ['entity'],
      ),
    },
    toRequest: ({ entity, ...params }) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      }
      const q = qs.toString();
      return { method: 'GET', url: `/api/${entity}${q ? `?${q}` : ''}` };
    },
  },
  {
    tool: {
      name: 'get_record',
      description: 'Obtiene un registro por id.',
      input_schema: object({ entity: { type: 'string', enum: ENTITIES }, id: id('Id del registro') }, [
        'entity',
        'id',
      ]),
    },
    toRequest: ({ entity, id: recordId }) => ({ method: 'GET', url: `/api/${entity}/${recordId}` }),
  },
  {
    tool: {
      name: 'delete_record',
      description:
        'Borra un registro por id. Es irreversible. Al borrar una empresa o contacto, sus registros vinculados quedan sin vínculo; al borrar un usuario, sus registros pasan al administrador.',
      input_schema: object({ entity: { type: 'string', enum: ENTITIES }, id: id('Id del registro') }, [
        'entity',
        'id',
      ]),
    },
    mutates: 'any',
    toRequest: ({ entity, id: recordId }) => ({ method: 'DELETE', url: `/api/${entity}/${recordId}` }),
  },
  ...createAndUpdate('companies', companyFields, ['name']),
  ...createAndUpdate('contacts', contactFields, ['firstName', 'lastName']),
  ...createAndUpdate('deals', dealFields, ['title'], ' Por defecto: value 0, currency USD y la primera etapa del embudo.'),
  {
    tool: {
      name: 'move_deal_stage',
      description:
        'Mueve un deal a otra etapa del embudo (consulta las etapas con get_pipeline). Al pasarlo a una etapa perdida, indica el motivo con lostReasonId.',
      input_schema: object(
        {
          id: id('Id del deal'),
          stage: { type: 'string', description: 'Clave de la etapa de destino (ver get_pipeline)' },
          lostReasonId: nullableId('Motivo de pérdida, sólo si la etapa de destino es perdida'),
        },
        ['id', 'stage'],
      ),
    },
    mutates: 'deals',
    toRequest: ({ id: recordId, stage, lostReasonId }) => ({
      method: 'PATCH',
      url: `/api/deals/${recordId}/stage`,
      body: { stage, ...(lostReasonId !== undefined ? { lostReasonId } : {}) },
    }),
  },
  ...createAndUpdate('activities', activityFields, ['type', 'subject'], ' Para marcarla como hecha usa completed: true.'),
  ...createAndUpdate('users', userFields, ['name', 'email', 'password'], ' Sólo administradores.'),
];

const BY_NAME = new Map(SPECS.map((s) => [s.tool.name, s]));

/**
 * Tool definitions sent to Claude. The list is the same for every user and every turn:
 * a stable prefix keeps the prompt cache warm and replayed thinking blocks valid.
 * Permissions are enforced by the API itself when the tool runs.
 */
export const AGENT_TOOLS: Tool[] = SPECS.map((s) => ({ ...s.tool, eager_input_streaming: true }));

export interface ToolOutcome {
  ok: boolean;
  /** JSON text returned to Claude as the tool_result content. */
  content: string;
  /** Entity whose data changed (for UI refresh), only on success. */
  changed?: string;
}

const MAX_RESULT_CHARS = 40_000;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isPositiveInt = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/**
 * Minimal shape check of model-supplied input before anything runs. Eager input
 * streaming means the API no longer validates tool input for us; the CRM endpoints
 * re-validate the payload strictly (zod) once the request reaches them.
 */
function checkInput(input: unknown): string | null {
  if (!isPlainObject(input)) return 'La entrada debe ser un objeto JSON';
  if ('entity' in input && !ENTITIES.includes(input.entity as Entity)) return 'Entidad desconocida';
  for (const key of ['id', 'companyId', 'contactId', 'dealId', 'page', 'pageSize']) {
    const v = input[key];
    if (v !== undefined && v !== null && !isPositiveInt(v)) return `${key} debe ser un entero positivo`;
  }
  return null;
}

/**
 * Loopback-only server for the core CRM API, started on first use. Tool calls go
 * through real HTTP so every Express behaviour (body parsing, auth, errors) is the
 * one the UI gets. It only accepts requests carrying a per-process random key, and
 * each request still needs the user's JWT.
 */
const INTERNAL_KEY = randomBytes(32).toString('hex');
let coreBase: Promise<string> | null = null;

function coreUrl(): Promise<string> {
  coreBase ??= new Promise((resolve, reject) => {
    const app = createCoreApp();
    const expected = Buffer.from(INTERNAL_KEY);
    const server = http.createServer((req, res) => {
      const given = Buffer.from(String(req.headers['x-internal-key'] ?? ''));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        res.writeHead(403).end();
        return;
      }
      app(req, res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.unref(); // never keeps the process alive on its own
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
  return coreBase;
}

const truncate = (s: string) =>
  s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}… [resultado truncado]` : s;

/** Runs one tool call against the CRM API, acting as the user who owns `token`. */
export async function executeTool(name: string, input: unknown, token: string): Promise<ToolOutcome> {
  const spec = BY_NAME.get(name);
  if (!spec) return { ok: false, content: JSON.stringify({ error: `Herramienta desconocida: ${name}` }) };
  const problem = checkInput(input);
  if (problem) return { ok: false, content: JSON.stringify({ error: problem }) };

  const req = spec.toRequest(input as Record<string, unknown>);
  const res = await fetch(`${await coreUrl()}${req.url}`, {
    method: req.method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-internal-key': INTERNAL_KEY,
      ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
  });

  const changed = res.ok ? changedEntity(spec, input) : undefined;
  if (res.status === 204) return { ok: true, content: JSON.stringify({ ok: true }), changed };
  const text = await res.text();
  const body = text ? truncate(text) : '{}';
  if (!res.ok) return { ok: false, content: JSON.stringify({ status: res.status, response: safeJson(body) }) };
  return { ok: true, content: body, changed };
}

function changedEntity(spec: ToolSpec, input: unknown): string | undefined {
  if (spec.mutates === 'any') return (input as { entity?: string }).entity;
  return spec.mutates;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

const RECORD_NAME: Record<string, (r: Record<string, unknown>) => string> = {
  companies: (r) => `empresa «${String(r.name)}»`,
  contacts: (r) => `contacto «${String(r.firstName)} ${String(r.lastName)}»`,
  deals: (r) => `deal «${String(r.title)}»${typeof r.value === 'number' ? ` (${r.value} ${String(r.currency ?? '')})`.replace(' )', ')') : ''}`,
  activities: (r) => `actividad «${String(r.subject)}»`,
  users: (r) => `usuario «${String(r.name)}» <${String(r.email)}>`,
};

/**
 * Human-readable description of the record a delete_record call targets, e.g. `contacto «Juan Pérez»`.
 * Null when the call is invalid or the record is not visible to the user (the delete itself will then fail).
 */
export async function describeRecord(input: unknown, token: string): Promise<string | null> {
  const { entity, id } = (input ?? {}) as { entity?: string; id?: number };
  const name = entity ? RECORD_NAME[entity] : undefined;
  if (!name) return null;
  const got = await executeTool('get_record', { entity, id }, token);
  if (!got.ok) return null;
  try {
    return `${name(JSON.parse(got.content) as Record<string, unknown>)} (id ${id})`;
  } catch {
    return null;
  }
}

export interface Change {
  field: string;
  from: string;
  to: string;
}

const UPDATE_ENTITY: Record<string, string> = {
  update_company: 'companies',
  update_contact: 'contacts',
  update_deal: 'deals',
  update_activity: 'activities',
  update_user: 'users',
  move_deal_stage: 'deals',
};

/** Tools that modify an existing record (they need the person's confirmation, like deletes). */
export const isUpdateTool = (name: string): boolean => name in UPDATE_ENTITY;

const FIELD_LABEL: Record<string, string> = {
  name: 'nombre', industry: 'sector', website: 'web', phone: 'teléfono', address: 'dirección',
  firstName: 'nombre', lastName: 'apellidos', email: 'email', position: 'cargo', companyId: 'empresa (id)',
  title: 'título', value: 'importe', currency: 'moneda', stage: 'etapa', contactId: 'contacto (id)',
  expectedCloseDate: 'cierre previsto', sourceId: 'origen', lostReasonId: 'motivo de pérdida', type: 'tipo', subject: 'asunto', description: 'descripción',
  dueDate: 'vencimiento', completed: 'completada', dealId: 'deal (id)', role: 'rol', password: 'contraseña',
};
const TYPE_ES: Record<string, string> = { call: 'Llamada', email: 'Email', meeting: 'Reunión', task: 'Tarea', note: 'Nota' };
const ROLE_ES: Record<string, string> = { admin: 'Administrador', sales: 'Ventas' };

/** Canonical form of a field value, so "acme.com" vs "https://acme.com" or "" vs null are not reported as changes. */
function canon(field: string, v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    if (field === 'email') return t.toLowerCase();
    if (field === 'currency') return t.toUpperCase();
    if (field === 'website') return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
    if (field === 'dueDate' || field === 'expectedCloseDate') {
      const ms = Date.parse(t);
      return Number.isNaN(ms) ? t : new Date(ms).toISOString();
    }
    return t;
  }
  return typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v);
}

function shown(field: string, v: unknown): string {
  const c = canon(field, v);
  if (c === null) return '(vacío)';
  if (field === 'password') return '(nueva contraseña)';
  if (typeof c === 'boolean') return c ? 'sí' : 'no';
  if (field === 'stage') return getStageByKey(String(c))?.name ?? String(c);
  if (field === 'sourceId' || field === 'lostReasonId') return getOption(Number(c))?.name ?? `#${String(c)}`;
  if (field === 'type') return TYPE_ES[String(c)] ?? String(c);
  if (field === 'role') return ROLE_ES[String(c)] ?? String(c);
  return String(c);
}

/**
 * What an update would change, for the confirmation shown to the person: the record and each field
 * that really changes (old -> new). Null when the call is invalid / the record is not visible (the call
 * then runs and fails normally) or when nothing would change (nothing to confirm).
 */
export async function describeChange(
  toolName: string,
  input: unknown,
  token: string,
): Promise<{ label: string; changes: Change[] } | null> {
  const entity = UPDATE_ENTITY[toolName];
  const { id, ...fields } = (input ?? {}) as Record<string, unknown>;
  if (!entity || typeof id !== 'number') return null;
  const got = await executeTool('get_record', { entity, id }, token);
  if (!got.ok) return null;
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(got.content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const changes: Change[] = [];
  for (const [field, next] of Object.entries(fields)) {
    if (field !== 'password' && canon(field, next) === canon(field, record[field])) continue;
    changes.push({
      field: FIELD_LABEL[field] ?? field,
      from: field === 'password' ? '' : shown(field, record[field]),
      to: shown(field, next),
    });
  }
  if (changes.length === 0) return null;
  return { label: `${RECORD_NAME[entity](record)} (id ${id})`, changes };
}

const TOOL_LABELS: Record<string, string> = {
  get_current_user: 'Consultando tu usuario',
  get_dashboard: 'Consultando el resumen',
  get_pipeline: 'Consultando el embudo',
  get_metrics: 'Calculando métricas',
  list_records: 'Buscando registros',
  get_record: 'Consultando un registro',
  delete_record: 'Borrando un registro',
  move_deal_stage: 'Moviendo el deal de etapa',
  create_company: 'Creando una empresa',
  update_company: 'Actualizando una empresa',
  create_contact: 'Creando un contacto',
  update_contact: 'Actualizando un contacto',
  create_deal: 'Creando un deal',
  update_deal: 'Actualizando un deal',
  create_activity: 'Creando una actividad',
  update_activity: 'Actualizando una actividad',
  create_user: 'Creando un usuario',
  update_user: 'Actualizando un usuario',
};

/** Short Spanish label for the UI ("Creando una empresa", ...). */
export function describeTool(name: string): string {
  return TOOL_LABELS[name] ?? 'Trabajando en el CRM';
}
