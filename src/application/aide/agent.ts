import { runAgentWithValidation } from '../../infra/agent-sdk/run-with-validation.js';
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

  try {
    const parsed = await runAgentWithValidation(
      {
        role: 'aide',
        model: MODEL_IDS.AIDE,
        systemPrompt: AIDE_SYSTEM_PROMPT,
        userMessage,
        maxTurns: opts.max_turns ?? MAX_TURNS.AIDE,
        tools: AGENT_TOOLS.AIDE,
        skipCaveman: opts.skipCaveman,
      },
      AideResponseSchema,
    );
    logger.debug({ task_id: taskId, status: parsed.status }, 'Aide response parsed and validated');
    return parsed;
  } catch (err) {
    // Infrastructure errors (spawn failures, timeouts) must propagate unchanged
    // so withAgentRetry can retry them. Only parse/schema failures become
    // INVALID_JSON_RESPONSE — retrying those would not help.
    if (err instanceof CouncilError && (err.code === 'AGENT_SDK_ERROR' || err.code === 'AGENT_TIMEOUT')) {
      throw err;
    }
    logger.error({ err }, 'Aide failed after parse/validate retry');
    throw new CouncilError(
      'Aide returned an invalid or schema-violating response',
      'INVALID_JSON_RESPONSE',
      'aide',
      err,
    );
  }
}
