// Evaluation-loop config.
//
// When the Supervisor flags an agent output (approved === false), the
// orchestrator re-invokes the agent with the Supervisor's flags and
// recommendation appended to the prompt. This turns the Supervisor from
// an advisory observer into an active quality gate.
//
// COUNCIL_EVAL_RETRIES controls how many *additional* attempts are made
// after the initial invocation (default: 2 → up to 3 total attempts).
// Clamped to [0, 5] — 0 disables the feature entirely, 5 is a hard ceiling
// to bound worst-case token spend per agent step.

import { logger } from '../logging/logger.js';

const DEFAULT_EVAL_RETRIES = 2;
const MIN_EVAL_RETRIES = 0;
const MAX_EVAL_RETRIES = 5;

/**
 * Resolves COUNCIL_EVAL_RETRIES from the environment.
 *
 * Rules:
 *   - Unset or empty          → default (2)
 *   - Non-integer / NaN       → default (2), warning logged
 *   - Negative                → clamped to 0, warning logged
 *   - Greater than ceiling    → clamped to MAX_EVAL_RETRIES (5), warning logged
 *
 * Validated once at process start; env vars don't change at runtime.
 */
export function resolveEvalRetries(): number {
  const raw = process.env['COUNCIL_EVAL_RETRIES'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_EVAL_RETRIES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    logger.warn(
      { COUNCIL_EVAL_RETRIES: raw, fallback: DEFAULT_EVAL_RETRIES },
      'COUNCIL_EVAL_RETRIES is not an integer — using default',
    );
    return DEFAULT_EVAL_RETRIES;
  }

  if (parsed < MIN_EVAL_RETRIES) {
    logger.warn(
      { COUNCIL_EVAL_RETRIES: raw, clamped_to: MIN_EVAL_RETRIES },
      'COUNCIL_EVAL_RETRIES below minimum — clamped',
    );
    return MIN_EVAL_RETRIES;
  }
  if (parsed > MAX_EVAL_RETRIES) {
    logger.warn(
      { COUNCIL_EVAL_RETRIES: raw, clamped_to: MAX_EVAL_RETRIES },
      'COUNCIL_EVAL_RETRIES above ceiling — clamped',
    );
    return MAX_EVAL_RETRIES;
  }
  return parsed;
}

export const EVAL_RETRIES: number = resolveEvalRetries();
