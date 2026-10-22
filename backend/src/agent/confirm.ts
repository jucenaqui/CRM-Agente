/**
 * Human confirmation for destructive tool calls made by the in-app assistant.
 *
 * The assistant's turn is a single open SSE request. When the model asks to delete a record the
 * loop emits `confirm_required` and waits here; the browser answers with
 * POST /api/agent/chat/confirm, which resolves the wait. Nothing is deleted unless the person
 * explicitly approves; no answer (timeout) or a closed browser counts as "no".
 */
export type Decision = 'approved' | 'denied' | 'expired';

interface Pending {
  userId: number;
  resolve: (d: Decision) => void;
}

const pending = new Map<string, Pending>();
const key = (userId: number, callId: string) => `${userId}:${callId}`;

export const confirmTimeoutMs = (): number => {
  const n = Number(process.env.AGENT_CONFIRM_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 5 * 60_000;
};

/** Resolves when the user decides, the timeout passes or `signal` aborts (browser gone). */
export function waitForDecision(userId: number, callId: string, signal?: AbortSignal): Promise<Decision> {
  return new Promise((resolve) => {
    const k = key(userId, callId);
    let timer: NodeJS.Timeout | undefined;
    const finish = (d: Decision) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      pending.delete(k);
      resolve(d);
    };
    const onAbort = () => finish('expired');
    if (signal?.aborted) return resolve('expired');
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish('expired'), confirmTimeoutMs());
    pending.set(k, { userId, resolve: finish });
  });
}

/** Applies the user's answer. Returns false if nothing is waiting for that user/call. */
export function decide(userId: number, callId: string, approve: boolean): boolean {
  const p = pending.get(key(userId, callId));
  if (!p) return false;
  p.resolve(approve ? 'approved' : 'denied');
  return true;
}

export const pendingConfirmations = (): number => pending.size;
