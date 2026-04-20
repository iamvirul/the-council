import { runAgent } from '../../infra/agent-sdk/runner.js';
import { AIDE_SYSTEM_PROMPT, MODEL_IDS, MAX_TURNS, AGENT_TOOLS } from '../../domain/constants/index.js';
import { AideResponseSchema } from '../../domain/models/schemas.js';
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
    tools: AGENT_TOOLS.AIDE,
    skipCaveman: opts.skipCaveman,
  });

  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const cleaned = fenceMatch ? fenceMatch[1].trim() : raw.trim();

  try {
    const json: unknown = JSON.parse(cleaned);
    const parsed = AideResponseSchema.parse(json);
    logger.debug({ task_id: taskId, status: parsed.status }, 'Aide response parsed and validated');
    return parsed;
  } catch (err) {
    logger.error({ raw: raw.slice(0, 500), err }, 'Failed to parse/validate Aide response');
    throw new CouncilError(
      'Aide returned an invalid or schema-violating response',
      'INVALID_JSON_RESPONSE',
      'aide',
      err,
    );
  }
}