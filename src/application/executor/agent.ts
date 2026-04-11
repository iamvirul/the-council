import { runExecutorWithTools } from '../../infra/agent-sdk/runner.js';
import { EXECUTOR_SYSTEM_PROMPT, MODEL_IDS, MAX_TURNS } from '../../domain/constants/index.js';
import { ExecutorResponseSchema } from '../../domain/models/schemas.js';
import type { AgentInvokeOptions, ExecutorResponse } from '../../domain/models/types.js';
import { CouncilError } from '../../domain/models/types.js';
import { logger } from '../../infra/logging/logger.js';

export async function invokeExecutor(opts: AgentInvokeOptions): Promise<ExecutorResponse> {
  const userMessage = opts.context
    ? `Task: ${opts.problem}\n\nContext (Chancellor's plan):\n${opts.context}`
    : `Task: ${opts.problem}`;

  const raw = await runExecutorWithTools({
    role: 'executor',
    model: MODEL_IDS.EXECUTOR,
    systemPrompt: EXECUTOR_SYSTEM_PROMPT,
    userMessage,
    maxTurns: opts.max_turns ?? MAX_TURNS.EXECUTOR,
  });

  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const cleaned = fenceMatch ? fenceMatch[1].trim() : raw.trim();

  try {
    const json: unknown = JSON.parse(cleaned);
    const parsed = ExecutorResponseSchema.parse(json);
    logger.debug({ step_id: parsed.step_id, status: parsed.status }, 'Executor response parsed and validated');
    return parsed;
  } catch (err) {
    logger.error({ raw: raw.slice(0, 500), err }, 'Failed to parse/validate Executor response');
    throw new CouncilError(
      'Executor returned an invalid or schema-violating response',
      'INVALID_JSON_RESPONSE',
      'executor',
      err,
    );
  }
}
