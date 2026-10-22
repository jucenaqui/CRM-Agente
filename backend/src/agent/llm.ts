import Anthropic from '@anthropic-ai/sdk';

export type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];

/** The slice of the SDK the agent loop uses; tests swap in a scripted fake. */
export interface AgentLLM {
  stream(params: StreamParams): {
    on(event: 'text', listener: (delta: string) => void): unknown;
    finalMessage(): Promise<Anthropic.Beta.BetaMessage>;
  };
}

let override: AgentLLM | null = null;
let client: Anthropic | null = null;

/** True when the server has Anthropic credentials (or a test double is installed). */
export const isAgentConfigured = (): boolean =>
  override !== null || !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export function getAgentLLM(): AgentLLM {
  if (override) return override;
  client ??= new Anthropic();
  const c = client;
  return { stream: (params) => c.beta.messages.stream(params) };
}

/** Test hook: install a fake LLM (null restores the real client). */
export function setAgentLLM(llm: AgentLLM | null): void {
  override = llm;
}
