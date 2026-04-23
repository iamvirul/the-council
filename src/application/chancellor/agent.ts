import { runAgent } from '../../infra/agent-sdk/runner.js';
import { parseAgentJson } from '../../infra/agent-sdk/parse.js';
import { CHANCELLOR_SYSTEM_PROMPT, MODEL_IDS, MAX_TURNS, AGENT_TOOLS } from '../../domain/constants/index.js';
import { ChancellorResponseSchema } from '../../domain/models/schemas.js';
import type { AgentInvokeOptions, ChancellorResponse } from '../../domain/models/types.js';
import { CouncilError } from '../../domain/models/types.js';
import { logger } from '../../infra/logging/logger.js';

/**
 * Invoke the "chancellor" agent for the given problem, extract JSON from the agent's output,
 * validate it against the ChancellorResponse schema, and return the parsed response.
 *
 * @param opts - Options controlling the invocation. `opts.problem` is the prompt sent to the agent;
 *               when `opts.context` is present it is appended to the prompt. `opts.max_turns`
 *               overrides the agent turn limit. `opts.skipCaveman` requests skipping the caveman step.
 * @returns The validated `ChancellorResponse` produced by the agent.
 * @throws CouncilError when the agent's output cannot be parsed as JSON or fails schema validation.
 */
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
    tools: AGENT_TOOLS.CHANCELLOR,
    skipCaveman: opts.skipCaveman,
  });

  try {
    // parseAgentJson tolerates fenced output, prose-wrapped JSON, and bare
    // JSON — the CLI's output shape varies with model and load.
    const json = parseAgentJson(raw);
    // Runtime schema validation — a type assertion alone gives no protection
    // against malformed or injected agent responses.
    const parsed = ChancellorResponseSchema.parse(json);
    logger.debug({ steps: parsed.plan.length }, 'Chancellor plan parsed and validated');
    return parsed;
  } catch (err) {
    logger.error({ raw: raw.slice(0, 500), err }, 'Failed to parse/validate Chancellor response');
    throw new CouncilError(
      'Chancellor returned an invalid or schema-violating response',
      'INVALID_JSON_RESPONSE',
      'chancellor',
      err,
    );
  }
}