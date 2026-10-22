/**
 * `npm run agent:check` — verifies that the Anthropic credentials work and that every
 * model enabled for the agent (AGENT_MODELS) is available to this account.
 * Uses the Models API only: no tokens are generated, so it costs nothing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from '../config.js';
import { defaultModel, enabledModels } from './models.js';

loadEnv();

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error('Falta ANTHROPIC_API_KEY (en backend/.env o en el entorno).');
  process.exit(1);
}

const client = new Anthropic();
let failures = 0;
console.log(`Modelo por defecto: ${defaultModel()?.id ?? '(ninguno habilitado)'}`);
for (const model of enabledModels()) {
  try {
    const info = await client.models.retrieve(model.id);
    console.log(`OK    ${model.id.padEnd(20)} ${info.display_name}`);
  } catch (err) {
    failures++;
    const reason =
      err instanceof Anthropic.AuthenticationError
        ? 'clave inválida'
        : err instanceof Anthropic.NotFoundError
          ? 'no disponible para esta cuenta'
          : err instanceof Anthropic.APIError
            ? `error ${err.status}`
            : 'sin conexión';
    console.log(`FALLA ${model.id.padEnd(20)} ${reason}`);
  }
}
process.exit(failures ? 1 : 0);
