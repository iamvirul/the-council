import { runAgentWithValidation } from '../../infra/agent-sdk/run-with-validation.js';
import { SUPERVISOR_SYSTEM_PROMPT, MODEL_IDS, MAX_TURNS } from '../../domain/constants/index.js';
import { SupervisorVerdictSchema } from '../../domain/models/schemas.js';
import type { SupervisorVerdict } from '../../domain/models/types.js';
import { CouncilError } from '../../domain/models/types.js';
import { logger } from '../../infra/logging/logger.js';

export interface SupervisorContext {
  subject_id: string;
  subject_type: 'executor_step' | 'aide_task';
  original_problem: string;
  intent: string;   // the step description or task description
  output: string;   // the result to review
}

export async function invokeSupervisor(ctx: SupervisorContext): Promise<SupervisorVerdict> {
  const userMessage = [
    `Original problem: ${ctx.original_problem}`,
    ``,
    `What was attempted (${ctx.subject_type}): ${ctx.intent}`,
    `Subject ID: ${ctx.subject_id}`,
    ``,
    `Output to review:`,
    ctx.output,
  ].join('\n');

  try {
    const parsed = await runAgentWithValidation(
      {
        role: 'supervisor',
        model: MODEL_IDS.SUPERVISOR,
        systemPrompt: SUPERVISOR_SYSTEM_PROMPT,
        userMessage,
        maxTurns: MAX_TURNS.SUPERVISOR,
        // Supervisor recommendation is user-facing prose — skip compression.
        skipCaveman: true,
      },
      SupervisorVerdictSchema,
    );
    logger.debug(
      { subject: ctx.subject_id, subject_type: ctx.subject_type, approved: parsed.approved, flags: parsed.flags.length },
      'Supervisor verdict',
    );
    return parsed;
  } catch (err) {
    logger.error({ err }, 'Supervisor failed after parse/validate retry');
    throw new CouncilError(
      'Supervisor returned an invalid or schema-violating response',
      'SUPERVISOR_ERROR',
      'supervisor',
      err,
    );
  }
}
