import type { ApiErrorBody } from './types';

const TOKEN_KEY = 'newcrm.token';
const API_BASE = '/api';

/** Error normalizado según el formato del contrato: { error: { code, message, details? } }. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Errores por campo si el backend los envía en `details` (issues de zod, flatten() u objeto clave→mensaje). */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    const d = this.details;
    if (Array.isArray(d)) {
      for (const issue of d) {
        if (issue && typeof issue === 'object') {
          const i = issue as { path?: unknown; message?: unknown; field?: unknown };
          const key = Array.isArray(i.path)
            ? i.path.join('.')
            : typeof i.path === 'string' && i.path
              ? i.path
              : typeof i.field === 'string'
                ? i.field
                : undefined;
          if (key && typeof i.message === 'string' && !out[key]) out[key] = i.message;
        }
      }
    } else if (d && typeof d === 'object') {
      const obj = d as Record<string, unknown>;
      const src = (obj.fieldErrors && typeof obj.fieldErrors === 'object' ? obj.fieldErrors : obj) as Record<
        string,
        unknown
      >;
      for (const [k, v] of Object.entries(src)) {
        if (typeof v === 'string') out[k] = v;
        else if (Array.isArray(v) && typeof v[0] === 'string') out[k] = v[0];
      }
    }
    return out;
  }
}

// ---- Token: en memoria + localStorage ----
let memoryToken: string | null = null;
let tokenLoaded = false;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  if (!tokenLoaded) {
    tokenLoaded = true;
    try {
      memoryToken = storage()?.getItem(TOKEN_KEY) ?? null;
    } catch {
      memoryToken = null;
    }
  }
  return memoryToken;
}

export function setToken(token: string | null): void {
  memoryToken = token;
  tokenLoaded = true;
  try {
    const s = storage();
    if (token) s?.setItem(TOKEN_KEY, token);
    else s?.removeItem(TOKEN_KEY);
  } catch {
    /* almacenamiento no disponible: el token queda sólo en memoria */
  }
}

/** Reinicia la caché interna del token (útil en tests). */
export function resetTokenCache(): void {
  memoryToken = null;
  tokenLoaded = false;
}

// ---- Handler de 401 (logout automático) ----
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export type QueryValue = string | number | boolean | null | undefined;

export function buildQuery(params?: object): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, QueryValue>)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Solicitud inválida',
  401: 'Sesión expirada o credenciales inválidas',
  403: 'No tienes permiso para realizar esta acción',
  404: 'Recurso no encontrado',
  409: 'Conflicto: el recurso ya existe',
  422: 'Datos inválidos',
  429: 'Demasiadas solicitudes, intenta de nuevo en unos minutos',
  500: 'Error interno del servidor',
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: object;
  /** false: no dispara el logout automático en 401 (login/registro). */
  handleUnauthorized?: boolean;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, handleUnauthorized = true, signal } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${buildQuery(query)}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    const e =
      data && typeof data === 'object' ? (data as Partial<ApiErrorBody>).error : undefined;
    const err = new ApiError(
      res.status,
      e?.code ?? `HTTP_${res.status}`,
      e?.message ?? DEFAULT_MESSAGES[res.status] ?? `Error ${res.status}`,
      e?.details,
    );
    if (res.status === 401 && handleUnauthorized) {
      setToken(null);
      unauthorizedHandler?.();
    }
    throw err;
  }

  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Error inesperado';
}
