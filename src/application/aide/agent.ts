import { runAgent } from '../../infra/agent-sdk/runner.js';
import { AIDE_SYSTEM_PROMPT, MODEL_IDS, MAX_TURNS, AGENT_TOOLS } from '../../domain/constants/index.js';
import { AideResponseSchema } from '../../domain/models/schemas.js';
import type { AgentInvokeOptions, AideResponse } from '../../domain/models/types.js';
import { CouncilError } from '../../domain/models/types.js';
import { logger } from '../../infra/logging/logger.js';

/**
 * Invokes the "aide" agent with a constructed user message and returns the parsed, validated response.
 *
 * @param taskId - The task identifier included in the agent message
 * @param opts - Invocation options (`problem`, optional `context`, optional `max_turns`, optional `skipCaveman`)
 * @returns The validated AideResponse parsed from the agent's JSON output
 * @throws CouncilError when the agent returns invalid JSON or a value that fails schema validation (code: 'INVALID_JSON_RESPONSE')
 */
export async function invokeAide(
  taskId: string,
  opts: AgentInvokeOptions,
): Promise<AideResponse> {
  const parts: string[] = [`Task ID: ${taskId}`, `Task: ${opts.problem}`];
  if (opts.context) parts.push('', `Context: ${opts.context}`);
  if (opts.supervisor_feedback) parts.push('', opts.supervisor_feedback);
  const userMessage = parts.join('\n');

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