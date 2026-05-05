import { runAgentWithValidation } from '../../infra/agent-sdk/run-with-validation.js';
import { EXECUTOR_SYSTEM_PROMPT, MODEL_IDS, MAX_TURNS, AGENT_TOOLS } from '../../domain/constants/index.js';
import { ExecutorResponseSchema } from '../../domain/models/schemas.js';
import type { AgentInvokeOptions, ExecutorResponse } from '../../domain/models/types.js';
import { CouncilError } from '../../domain/models/types.js';
import { logger } from '../../infra/logging/logger.js';

/**
 * Invokes the executor agent with the provided task/context, extracts and parses any fenced JSON in the agent reply, validates it against `ExecutorResponseSchema`, and returns the validated response.
 *
 * @param opts - Invocation options: `opts.problem` is used as the task; if present `opts.context` is included as "Chancellor's plan". May include `opts.max_turns` to override the executor turn limit and `opts.skipCaveman` to control caveman behavior.
 * @returns The validated `ExecutorResponse` parsed from the agent's output.
 * @throws CouncilError with code `"INVALID_JSON_RESPONSE"` when the agent's output cannot be parsed as JSON or fails schema validation.
 */
export async function invokeExecutor(opts: AgentInvokeOptions): Promise<ExecutorResponse> {
  const parts: string[] = [`Task: ${opts.problem}`];
  if (opts.context) parts.push('', `Context (Chancellor's plan):`, opts.context);
  if (opts.supervisor_feedback) parts.push('', opts.supervisor_feedback);
  const userMessage = parts.join('\n');

  try {
    const parsed = await runAgentWithValidation(
      {
        role: 'executor',
        model: MODEL_IDS.EXECUTOR,
        systemPrompt: EXECUTOR_SYSTEM_PROMPT,
        userMessage,
        maxTurns: opts.max_turns ?? MAX_TURNS.EXECUTOR,
        tools: AGENT_TOOLS.EXECUTOR,
        skipCaveman: opts.skipCaveman,
      },
      ExecutorResponseSchema,
    );
    logger.debug({ step_id: parsed.step_id, status: parsed.status }, 'Executor response parsed and validated');
    return parsed;
  } catch (err) {
    // Infrastructure errors (spawn failures, timeouts) must propagate unchanged
    // so withAgentRetry can retry them. Only parse/schema failures become
    // INVALID_JSON_RESPONSE — retrying those would not help.
    if (err instanceof CouncilError && (err.code === 'AGENT_SDK_ERROR' || err.code === 'AGENT_TIMEOUT')) {
      throw err;
    }
    logger.error({ err }, 'Executor failed after parse/validate retry');
    throw new CouncilError(
      'Executor returned an invalid or schema-violating response',
      'INVALID_JSON_RESPONSE',
      'executor',
      err,
    );
  }
}
