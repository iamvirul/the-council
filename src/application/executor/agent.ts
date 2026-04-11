import { runExecutorWithTools } from '../../infra/agent-sdk/runner.js';
import { EXECUTOR_SYSTEM_PROMPT, MODEL_IDS, MAX_TURNS } from '../../domain/constants/index.js';
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

  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as ExecutorResponse;
    logger.debug({ step_id: parsed.step_id, status: parsed.status }, 'Executor response parsed');
    return parsed;
  } catch (err) {
    logger.error({ raw: raw.slice(0, 500), err }, 'Failed to parse Executor JSON response');
    throw new CouncilError(
      'Executor returned invalid JSON',
      'INVALID_JSON_RESPONSE',
      'executor',
      err,
    );
  }
}
