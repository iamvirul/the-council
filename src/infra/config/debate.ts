// Resolves the COUNCIL_DEBATE_ROUNDS environment variable.
//
// When set to N > 0, the orchestrator runs a critique-revise loop before
// handing the Chancellor plan to the Executor. Each round invokes a critic
// that reviews the current plan and either approves it (early exit) or
// requests revisions (Chancellor re-plans with the critique as context).
//
// Debate is expensive — it multiplies Chancellor invocations — so it is off
// by default and only applies to complex problems.

import { logger } from '../logging/logger.js';

const DEFAULT_DEBATE_ROUNDS = 0; // off by default
const MAX_DEBATE_ROUNDS = 3;     // hard cap — beyond this the cost is prohibitive

export function resolveDebateRounds(): number {
  const raw = process.env['COUNCIL_DEBATE_ROUNDS'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_DEBATE_ROUNDS;

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    logger.warn(
      { raw, fallback: DEFAULT_DEBATE_ROUNDS },
      'Invalid COUNCIL_DEBATE_ROUNDS — must be a non-negative integer; debate disabled',
    );
    return DEFAULT_DEBATE_ROUNDS;
  }

  if (parsed < 0) {
    logger.warn(
      { raw, fallback: DEFAULT_DEBATE_ROUNDS },
      'COUNCIL_DEBATE_ROUNDS < 0 — clamped to 0 (debate disabled)',
    );
    return DEFAULT_DEBATE_ROUNDS;
  }

  if (parsed > MAX_DEBATE_ROUNDS) {
    logger.warn(
      { raw, clamped: MAX_DEBATE_ROUNDS },
      `COUNCIL_DEBATE_ROUNDS exceeds max (${MAX_DEBATE_ROUNDS}) — clamped`,
    );
    return MAX_DEBATE_ROUNDS;
  }

  return parsed;
}

export const DEBATE_ROUNDS: number = resolveDebateRounds();
