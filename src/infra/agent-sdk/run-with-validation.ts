// Agent-invocation retry wrapper.
//
// In practice the claude CLI occasionally produces a response that either
// won't parse as JSON (prose wrapping that even parseAgentJson can't
// recover) or parses but fails schema validation (a field missing, an
// enum value out of range). These failures are transient and uncorrelated
// — re-running the same prompt usually yields a clean response.
//
// This helper centralises the retry-once behaviour so every agent invoker
// gets the same robustness with a single line of code. It is orthogonal
// to the Supervisor evaluation loop (which retries on semantic
// rejection, not on parse failure) and fires BEFORE the Supervisor ever
// sees the output, so a spurious first-call parse error never reaches
// the caller.

import type { ZodType } from 'zod';
import { runAgent, type RunAgentParams } from './runner.js';
import { parseAgentJson } from './parse.js';
import { logger } from '../logging/logger.js';

/** Max attempts per invoke — initial + 1 retry. Hardcoded because the */
/** retry fires on genuine CLI / model flakiness, not on user-visible quality */
/** issues (those are the Supervisor eval loop's job). */
const MAX_VALIDATION_ATTEMPTS = 2;

/**
 * Invoke an agent, parse its JSON response, and validate it against the
 * provided Zod schema. If the parse or validation fails on the first
 * attempt, the agent is invoked again. The last failure is re-thrown so
 * the caller can wrap it into a CouncilError with the correct code.
 */
export async function runAgentWithValidation<T>(
  params: RunAgentParams,
  schema: ZodType<T>,
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
    const raw = await runAgent(params);
    try {
      return schema.parse(parseAgentJson(raw));
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_VALIDATION_ATTEMPTS) {
        logger.warn(
          {
            role: params.role,
            attempt,
            raw_preview: raw.slice(0, 300),
            err,
          },
          'Agent response failed parse/validate — retrying',
        );
      }
    }
  }

  throw lastErr;
}
