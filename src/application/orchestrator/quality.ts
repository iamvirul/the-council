// Pure quality-summary helper.
//
// Kept in its own module (separate from orchestrator/index.ts) so it can be
// imported by tests and the MCP server without pulling in the full
// orchestrator dependency graph (runner.ts, agent SDKs, claude CLI resolution).

import type { SupervisorVerdict } from '../../domain/models/types.js';

export interface QualitySummary {
  avg_score: number;
  min_score: number;
  min_score_subject: string;
  total_flags: number;
}

/**
 * Computes aggregate quality metrics from all Supervisor verdicts recorded on
 * a session. Returns null when there are no verdicts (nothing to summarise).
 */
export function computeQualitySummary(verdicts: SupervisorVerdict[]): QualitySummary | null {
  if (verdicts.length === 0) return null;

  let total = 0;
  let min = 101;
  let minSubject = '';
  let flags = 0;

  for (const v of verdicts) {
    total += v.score;
    flags += v.flags.length;
    if (v.score < min) {
      min = v.score;
      minSubject = v.subject;
    }
  }

  return {
    avg_score: Math.round(total / verdicts.length),
    min_score: min,
    min_score_subject: minSubject,
    total_flags: flags,
  };
}
