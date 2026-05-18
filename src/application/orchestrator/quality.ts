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
 * a session. Returns null when no verdicts have a score (score is optional —
 * some model versions omit it; flag counts are still surfaced in that case via
 * the total_flags field, but avg/min scores require at least one scored verdict).
 */
export function computeQualitySummary(verdicts: SupervisorVerdict[]): QualitySummary | null {
  if (verdicts.length === 0) return null;

  const scored = verdicts.filter((v): v is SupervisorVerdict & { score: number } => v.score !== undefined);

  // Always count flags — even unscored verdicts contribute flag signal.
  const totalFlags = verdicts.reduce((n, v) => n + v.flags.length, 0);

  if (scored.length === 0) {
    // Verdicts exist but none carry a score — surface flag count only.
    return {
      avg_score: -1,           // sentinel: score unavailable
      min_score: -1,
      min_score_subject: '',
      total_flags: totalFlags,
    };
  }

  let total = 0;
  let min = 101;
  let minSubject = '';

  for (const v of scored) {
    total += v.score;
    if (v.score < min) {
      min = v.score;
      minSubject = v.subject;
    }
  }

  return {
    avg_score: Math.round(total / scored.length),
    min_score: min,
    min_score_subject: minSubject,
    total_flags: totalFlags,
  };
}
