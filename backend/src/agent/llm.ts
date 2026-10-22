import Anthropic from '@anthropic-ai/sdk';

export type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];

/** The slice of the SDK the agent loop uses; tests swap in a scripted fake. */
export interface AgentLLM {
  stream(
    params: StreamParams,
    apiKey: string,
  ): {
    on(event: 'text', listener: (delta: string) => void): unknown;
    finalMessage(): Promise<Anthropic.Beta.BetaMessage>;
  };
}

let override: AgentLLM | null = null;
let validatorOverride: ((apiKey: string) => Promise<void>) | null = null;
const clients = new Map<string, Anthropic>();

function clientFor(apiKey: string): Anthropic {
  let c = clients.get(apiKey);
  if (!c) {
    c = new Anthropic({ apiKey });
    clients.set(apiKey, c);
  }
  return c;
}

export function getAgentLLM(): AgentLLM {
  return override ?? { stream: (params, apiKey) => clientFor(apiKey).beta.messages.stream(params) };
}

/** Checks a key against Anthropic without generating tokens (lists one model). Throws the SDK error. */
export async function validateAnthropicKey(apiKey: string): Promise<void> {
  if (validatorOverride) return validatorOverride(apiKey);
  await new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 }).models.list({ limit: 1 });
}

/** Test hooks (null restores the real client). */
export function setAgentLLM(llm: AgentLLM | null): void {
  override = llm;
}
export function setKeyValidator(fn: ((apiKey: string) => Promise<void>) | null): void {
  validatorOverride = fn;
}
