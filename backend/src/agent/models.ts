/**
 * Claude models the customer can pick for the agent.
 *
 * All four accept the exact same request shape the agent sends: adaptive thinking
 * (thinking param omitted), `output_config.effort`, `tool_choice` auto, no sampling
 * params. Older models (e.g. Haiku 4.5, which still needs `budget_tokens`) are left
 * out on purpose so the loop never has to branch per model.
 */
export interface AgentModel {
  id: string;
  label: string;
  description: string;
  /** USD per 1M tokens (Claude API list price). */
  inputPrice: number;
  outputPrice: number;
  /** USD per 1M tokens read from the prompt cache (varies per model, not a fixed % of input). */
  cacheReadPrice: number;
  /** Server-side refusal fallback (`fallbacks: "default"`) is available for this model. */
  serverFallback: boolean;
}

export const MODEL_CATALOG: readonly AgentModel[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    description: 'Equilibrio recomendado: muy capaz para tareas de varios pasos.',
    inputPrice: 4,
    outputPrice: 20,
    cacheReadPrice: 0.2,
    serverFallback: true,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    description: 'Rápido y más económico para el trabajo diario.',
    inputPrice: 2,
    outputPrice: 10,
    cacheReadPrice: 0.2,
    serverFallback: true,
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    description: 'El más rápido y barato, para consultas y cambios sencillos.',
    inputPrice: 0.1,
    outputPrice: 0.5,
    cacheReadPrice: 0.01,
    serverFallback: false,
  },
  {
    id: 'claude-fable-5-1',
    label: 'Claude Fable 5.1',
    description: 'El más potente, para análisis complejos. Más lento y caro.',
    inputPrice: 10,
    outputPrice: 50,
    cacheReadPrice: 0.25,
    serverFallback: true,
  },
];

export const FALLBACK_DEFAULT_MODEL = 'claude-opus-5-5';

/** Models enabled by the deployment (`AGENT_MODELS`, comma-separated); default: whole catalog. */
export function enabledModels(): AgentModel[] {
  const raw = process.env.AGENT_MODELS?.trim();
  if (!raw) return [...MODEL_CATALOG];
  const wanted = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  return MODEL_CATALOG.filter((m) => wanted.has(m.id));
}

export function defaultModel(): AgentModel | undefined {
  const models = enabledModels();
  const wanted = process.env.AGENT_DEFAULT_MODEL?.trim() || FALLBACK_DEFAULT_MODEL;
  return models.find((m) => m.id === wanted) ?? models[0];
}

export const findEnabledModel = (id: string): AgentModel | undefined =>
  enabledModels().find((m) => m.id === id);
