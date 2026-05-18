// Score-gate config.
//
// When the Supervisor's numeric score for an agent output falls below
// COUNCIL_MIN_SCORE, the orchestrator treats it identically to an
// `approved: false` verdict and triggers the evaluation retry loop.
//
// Setting COUNCIL_MIN_SCORE to 0 (the default) disables the gate — only
// the boolean `approved` field drives retries. Any value 1–100 activates
// score-based gating on top of the boolean gate.
//
// Range: [0, 100]. Values outside the range are clamped with a startup
// warning, matching the pattern used by COUNCIL_AGENT_TIMEOUT_MS.

import { logger } from '../logging/logger.js';

const DEFAULT_MIN_SCORE = 0;   // off by default
const MIN_ALLOWED = 0;
const MAX_ALLOWED = 100;

/**
 * Resolves COUNCIL_MIN_SCORE from the environment.
 *
 * Rules:
 *   - Unset or empty    → 0 (gate disabled)
 *   - Non-integer / NaN → 0, warning logged
 *   - Below 0           → clamped to 0, warning logged
 *   - Above 100         → clamped to 100, warning logged
 */
export function resolveMinScore(): number {
  const raw = process.env['COUNCIL_MIN_SCORE'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_MIN_SCORE;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    logger.warn(
      { COUNCIL_MIN_SCORE: raw, fallback: DEFAULT_MIN_SCORE },
      'COUNCIL_MIN_SCORE is not an integer — score gate disabled',
    );
    return DEFAULT_MIN_SCORE;
  }

  if (parsed < MIN_ALLOWED) {
    logger.warn(
      { COUNCIL_MIN_SCORE: raw, clamped_to: MIN_ALLOWED },
      'COUNCIL_MIN_SCORE below 0 — clamped to 0 (gate disabled)',
    );
    return MIN_ALLOWED;
  }
  if (parsed > MAX_ALLOWED) {
    logger.warn(
      { COUNCIL_MIN_SCORE: raw, clamped_to: MAX_ALLOWED },
      'COUNCIL_MIN_SCORE above 100 — clamped to 100',
    );
    return MAX_ALLOWED;
  }
  return parsed;
}

export const MIN_SCORE: number = resolveMinScore();
