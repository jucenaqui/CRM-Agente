export type Errors<T> = Partial<Record<keyof T & string, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

export function required(v: string | null | undefined, label = 'Este campo'): string | undefined {
  return !v || !v.trim() ? `${label} es obligatorio` : undefined;
}

export function maxLen(v: string | null | undefined, n: number): string | undefined {
  return v && v.length > n ? `Máximo ${n} caracteres` : undefined;
}

export function optionalEmail(v: string | null | undefined): string | undefined {
  return v && v.trim() && !isEmail(v) ? 'Email inválido' : undefined;
}

export function passwordRule(v: string): string | undefined {
  if (!v) return 'La contraseña es obligatoria';
  if (v.length < 8) return 'Mínimo 8 caracteres';
  if (v.length > 128) return 'Máximo 128 caracteres';
  return undefined;
}

export function hasErrors<T>(e: Errors<T>): boolean {
  return Object.values(e).some(Boolean);
}

/** Elimina claves con valor undefined. */
export function clean<T extends object>(e: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(e)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
