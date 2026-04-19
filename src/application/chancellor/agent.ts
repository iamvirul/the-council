import { runAgent } from '../../infra/agent-sdk/runner.js';
import { CHANCELLOR_SYSTEM_PROMPT, MODEL_IDS, MAX_TURNS } from '../../domain/constants/index.js';
import { ChancellorResponseSchema } from '../../domain/models/schemas.js';
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
    skipCaveman: opts.skipCaveman,
  });

  // Extract JSON from inside a code fence if present, otherwise use the raw string.
  // Non-greedy match handles multiple fences in the response correctly.
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const cleaned = fenceMatch ? fenceMatch[1].trim() : raw.trim();

  try {
    const json: unknown = JSON.parse(cleaned);
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