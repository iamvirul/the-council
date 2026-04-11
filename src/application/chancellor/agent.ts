import { runAgent } from '../../infra/agent-sdk/runner.js';
import { CHANCELLOR_SYSTEM_PROMPT, MODEL_IDS, MAX_TURNS } from '../../domain/constants/index.js';
import type { AgentInvokeOptions, ChancellorResponse } from '../../domain/models/types.js';
import { CouncilError } from '../../domain/models/types.js';
import { logger } from '../../infra/logging/logger.js';

export async function invokeChancellor(opts: AgentInvokeOptions): Promise<ChancellorResponse> {
  const userMessage = opts.context
    ? `Problem: ${opts.problem}\n\nContext: ${opts.context}`
    : `Problem: ${opts.problem}`;

  const raw = await runAgent({
    role: 'chancellor',
    model: MODEL_IDS.CHANCELLOR,
    systemPrompt: CHANCELLOR_SYSTEM_PROMPT,
    userMessage,
    maxTurns: opts.max_turns ?? MAX_TURNS.CHANCELLOR,
  });

  // Strip markdown code fences if the model wrapped the JSON
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as ChancellorResponse;
    logger.debug({ steps: parsed.plan?.length }, 'Chancellor plan parsed');
    return parsed;
  } catch (err) {
    logger.error({ raw: raw.slice(0, 500), err }, 'Failed to parse Chancellor JSON response');
    throw new CouncilError(
      'Chancellor returned invalid JSON',
      'INVALID_JSON_RESPONSE',
      'chancellor',
      err,
    );
  }
}
