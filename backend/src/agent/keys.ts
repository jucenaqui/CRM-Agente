import { getDb, nowIso } from '../db.js';
import { decryptSecret, encryptSecret } from '../lib/secrets.js';

export type KeySource = 'customer' | 'provider';

/**
 * Which Anthropic key pays for the agent (AGENT_KEY_POLICY, set by whoever runs the install):
 * - default: the customer's key if they saved one (and only that one); otherwise the provider's.
 * - provider_only: always the provider's key; a saved customer key is ignored.
 * - customer_only: only the customer's key; the provider's is never used.
 * - customer_then_provider: the customer's key first; if it is out of credit or invalid, the
 *   provider's key takes over, limited by AGENT_FALLBACK_MONTHLY_CAP_USD.
 */
export type KeyPolicy = 'default' | 'provider_only' | 'customer_only' | 'customer_then_provider';

const POLICIES: readonly KeyPolicy[] = ['default', 'provider_only', 'customer_only', 'customer_then_provider'];

export function getPolicy(): KeyPolicy {
  const raw = process.env.AGENT_KEY_POLICY?.trim();
  return POLICIES.includes(raw as KeyPolicy) ? (raw as KeyPolicy) : 'default';
}

export interface KeyCandidate {
  source: KeySource;
  apiKey: string;
  /** True when this key only runs because the customer's own key failed. */
  viaFallback: boolean;
}

// ---- settings table ----

const getSetting = (key: string): string | undefined =>
  (getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;

const setSetting = (key: string, value: string): void => {
  getDb()
    .prepare(
      'INSERT INTO app_settings (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt',
    )
    .run(key, value, nowIso());
};

const deleteSettings = (...keys: string[]): void => {
  const del = getDb().prepare('DELETE FROM app_settings WHERE key = ?');
  for (const k of keys) del.run(k);
};

// ---- customer key ----

export type CustomerKeyStatus = 'unverified' | 'ok' | 'exhausted' | 'invalid';

const K = {
  enc: 'customer_key_enc',
  last4: 'customer_key_last4',
  status: 'customer_key_status',
  statusAt: 'customer_key_status_at',
} as const;

export function saveCustomerKey(apiKey: string): void {
  setSetting(K.enc, encryptSecret(apiKey));
  setSetting(K.last4, apiKey.slice(-4));
  setSetting(K.status, 'ok');
  setSetting(K.statusAt, nowIso());
}

export function removeCustomerKey(): void {
  deleteSettings(K.enc, K.last4, K.status, K.statusAt);
}

/** The decrypted customer key, or undefined if none is saved (or it can no longer be decrypted). */
export function getCustomerKey(): string | undefined {
  const blob = getSetting(K.enc);
  return blob ? (decryptSecret(blob) ?? undefined) : undefined;
}

export function setCustomerKeyStatus(status: CustomerKeyStatus): void {
  if (getSetting(K.status) === status) return;
  setSetting(K.status, status);
  setSetting(K.statusAt, nowIso());
}

export function customerKeyInfo(): {
  configured: boolean;
  last4: string | null;
  status: CustomerKeyStatus | null;
  statusAt: string | null;
} {
  const configured = getCustomerKey() !== undefined;
  return {
    configured,
    last4: configured ? (getSetting(K.last4) ?? null) : null,
    status: configured ? ((getSetting(K.status) as CustomerKeyStatus | undefined) ?? 'unverified') : null,
    statusAt: configured ? (getSetting(K.statusAt) ?? null) : null,
  };
}

// ---- provider key & resolution ----

export const getProviderKey = (): string | undefined => process.env.ANTHROPIC_API_KEY?.trim() || undefined;

/** Keys to try for the next agent step, in order, according to the policy. */
export function resolveKeys(): KeyCandidate[] {
  const customer = getCustomerKey();
  const provider = getProviderKey();
  const C: KeyCandidate | null = customer ? { source: 'customer', apiKey: customer, viaFallback: false } : null;
  const P = (viaFallback: boolean): KeyCandidate | null =>
    provider ? { source: 'provider', apiKey: provider, viaFallback } : null;

  const list =
    getPolicy() === 'provider_only'
      ? [P(false)]
      : getPolicy() === 'customer_only'
        ? [C]
        : getPolicy() === 'customer_then_provider'
          ? [C, P(C !== null)]
          : C
            ? [C]
            : [P(false)];
  return list.filter((k): k is KeyCandidate => k !== null);
}

export function getFallbackCapUsd(): number {
  const n = Number(process.env.AGENT_FALLBACK_MONTHLY_CAP_USD);
  return process.env.AGENT_FALLBACK_MONTHLY_CAP_USD !== undefined && Number.isFinite(n) && n >= 0 ? n : 10;
}

// ---- usage log ----

export interface SpendEntry {
  source: KeySource;
  viaFallback: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export function recordUsage(entry: SpendEntry, ctx: { userId: number; conversationId: number; model: string }): void {
  getDb()
    .prepare(
      `INSERT INTO agent_usage (userId, conversationId, model, keySource, viaFallback, inputTokens, outputTokens,
         cacheReadTokens, cacheWriteTokens, costUsd, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ctx.userId,
      ctx.conversationId,
      ctx.model,
      entry.source,
      entry.viaFallback ? 1 : 0,
      entry.inputTokens,
      entry.outputTokens,
      entry.cacheReadTokens,
      entry.cacheWriteTokens,
      entry.costUsd,
      nowIso(),
    );
}

/** UTC month bounds as ISO strings: [start, nextMonthStart). */
export function monthRange(month?: string): { month: string; start: string; end: string } {
  const m = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : nowIso().slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const start = new Date(Date.UTC(y, mo - 1, 1)).toISOString();
  const end = new Date(Date.UTC(y, mo, 1)).toISOString();
  return { month: m, start, end };
}

/** USD spent this month on the provider's key because the customer's key failed. */
export function fallbackSpentUsd(): number {
  const { start, end } = monthRange();
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(costUsd), 0) AS s FROM agent_usage WHERE viaFallback = 1 AND createdAt >= ? AND createdAt < ?')
    .get(start, end) as { s: number };
  return row.s;
}

export const fallbackCapReached = (): boolean => fallbackSpentUsd() >= getFallbackCapUsd();

export interface UsageReport {
  month: string;
  totals: { source: KeySource; viaFallback: boolean; messages: number; inputTokens: number; outputTokens: number; costUsd: number }[];
  byUser: { userId: number | null; name: string | null; source: KeySource; viaFallback: boolean; costUsd: number; steps: number }[];
}

export function usageReport(month?: string): UsageReport {
  const r = monthRange(month);
  const db = getDb();
  const totals = db
    .prepare(
      `SELECT keySource AS source, viaFallback, COUNT(*) AS messages,
              SUM(inputTokens + cacheReadTokens + cacheWriteTokens) AS inputTokens,
              SUM(outputTokens) AS outputTokens, SUM(costUsd) AS costUsd
       FROM agent_usage WHERE createdAt >= ? AND createdAt < ? GROUP BY keySource, viaFallback ORDER BY keySource, viaFallback`,
    )
    .all(r.start, r.end) as { source: KeySource; viaFallback: number; messages: number; inputTokens: number; outputTokens: number; costUsd: number }[];
  const byUser = db
    .prepare(
      `SELECT u.userId AS userId, us.name AS name, u.keySource AS source, u.viaFallback AS viaFallback,
              SUM(u.costUsd) AS costUsd, COUNT(*) AS steps
       FROM agent_usage u LEFT JOIN users us ON us.id = u.userId
       WHERE u.createdAt >= ? AND u.createdAt < ?
       GROUP BY u.userId, u.keySource, u.viaFallback ORDER BY costUsd DESC`,
    )
    .all(r.start, r.end) as { userId: number | null; name: string | null; source: KeySource; viaFallback: number; costUsd: number; steps: number }[];
  return {
    month: r.month,
    totals: totals.map((t) => ({ ...t, viaFallback: !!t.viaFallback })),
    byUser: byUser.map((u) => ({ ...u, viaFallback: !!u.viaFallback })),
  };
}
