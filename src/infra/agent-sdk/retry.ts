// Agent infrastructure retry with exponential backoff.
//
// Handles transient subprocess-level failures (AGENT_SDK_ERROR, AGENT_TIMEOUT)
// — the kind caused by CLI spawn issues, OOM kills, or rate-limit back-pressure.
// This is a different layer from:
//   - runAgentWithValidation: retries once on parse/validate failure
//   - Supervisor eval loop: retries on output quality rejection
//
// Only AGENT_SDK_ERROR and AGENT_TIMEOUT are retryable. All other CouncilError
// codes (INVALID_JSON_RESPONSE, SESSION_NOT_FOUND, etc.) propagate immediately
// — retrying them would not help.

import { logger } from '../logging/logger.js';
import { CouncilError } from '../../domain/models/types.js';

export interface RetryOptions {
  /** Total number of attempts including the first call. min: 1 */
  maxAttempts: number;
  /** Delay in ms before the second attempt; doubles each retry. */
  baseDelayMs: number;
  /** Hard cap on any single inter-attempt delay. */
  maxDelayMs: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,  // initial + 2 retries
  baseDelayMs: 1_000,
  maxDelayMs: 8_000,
};

const RETRYABLE_CODES = new Set<string>(['AGENT_SDK_ERROR', 'AGENT_TIMEOUT']);

function isRetryable(err: unknown): boolean {
  return err instanceof CouncilError && RETRYABLE_CODES.has(err.code);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calls `fn` and retries up to `options.maxAttempts - 1` times on transient
 * agent infrastructure failures, with exponential backoff between attempts.
 *
 * Non-retryable errors (parse failures, session errors, etc.) propagate on
 * the first throw without waiting.
 */
export async function withAgentRetry<T>(
  fn: () => Promise<T>,
  context: { role: string; step?: string },
  options: RetryOptions = DEFAULT_RETRY_OPTIONS,
): Promise<T> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === options.maxAttempts;

      if (!isRetryable(err) || isLast) throw err;

      const delayMs = Math.min(
        options.baseDelayMs * Math.pow(2, attempt - 1),
        options.maxDelayMs,
      );

      logger.warn(
        {
          role: context.role,
          step: context.step,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          code: err instanceof CouncilError ? err.code : undefined,
        },
        'Agent call failed — retrying with backoff',
      );

      await delay(delayMs);
    }
  }

  // Unreachable: either return or throw exits the loop.
  /* istanbul ignore next */
  throw new CouncilError('withAgentRetry: exhausted attempts without result', 'AGENT_SDK_ERROR');
}
