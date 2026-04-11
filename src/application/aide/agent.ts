import { runAgent } from '../../infra/agent-sdk/runner.js';
import { AIDE_SYSTEM_PROMPT, MODEL_IDS, MAX_TURNS } from '../../domain/constants/index.js';
import type { AgentInvokeOptions, AideResponse } from '../../domain/models/types.js';
import { CouncilError } from '../../domain/models/types.js';
import { logger } from '../../infra/logging/logger.js';

export async function invokeAide(
  taskId: string,
  opts: AgentInvokeOptions,
): Promise<AideResponse> {
  const userMessage = opts.context
    ? `Task ID: ${taskId}\nTask: ${opts.problem}\n\nContext: ${opts.context}`
    : `Task ID: ${taskId}\nTask: ${opts.problem}`;

  const raw = await runAgent({
    role: 'aide',
    model: MODEL_IDS.AIDE,
    systemPrompt: AIDE_SYSTEM_PROMPT,
    userMessage,
    maxTurns: opts.max_turns ?? MAX_TURNS.AIDE,
  });

  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as AideResponse;
    logger.debug({ task_id: taskId, status: parsed.status }, 'Aide response parsed');
    return parsed;
  } catch (err) {
    logger.error({ raw: raw.slice(0, 500), err }, 'Failed to parse Aide JSON response');
    throw new CouncilError(
      'Aide returned invalid JSON',
      'INVALID_JSON_RESPONSE',
      'aide',
      err,
    );
  }
}
