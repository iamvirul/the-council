// Supervisor-feedback formatter.
//
// Renders a rejected SupervisorVerdict as a prompt fragment that gets
// appended to the next agent invocation. The block is wrapped in sentinel
// markers so the downstream model can tell feedback apart from the task.
//
// Supervisor output is LLM-generated and only surface-validated (Zod
// max-length + type checks). A compromised or jailbroken Supervisor could
// forge the sentinel markers to terminate the feedback block early and
// inject instructions into the agent prompt. `sanitizeFeedbackText` strips
// any attempt to replay the sentinels; individual flag entries are also
// flattened to a single line since they are meant to be short categorical
// labels, not free-form paragraphs.
//
// Kept in its own module (rather than inline in orchestrator/index.ts) so
// it can be exercised by unit tests without pulling in the full
// orchestration graph and its infra dependencies.

import type { SupervisorVerdict } from '../../domain/models/types.js';

export const FEEDBACK_START =
  '--- SUPERVISOR FEEDBACK (previous attempt was rejected — address every flag below) ---';
export const FEEDBACK_END = '--- END SUPERVISOR FEEDBACK ---';
const SENTINEL_REDACTOR = /---\s*(?:END\s+)?SUPERVISOR\s+FEEDBACK[^\n-]*---/gi;

export function sanitizeFeedbackText(text: string): string {
  return text.replace(SENTINEL_REDACTOR, '[REDACTED]');
}

/**
 * Formats a rejected Supervisor verdict as feedback for the next agent
 * attempt. The block is wrapped in sentinel markers. All content is
 * sanitized first so a malicious Supervisor cannot forge the closing
 * sentinel to inject instructions outside the block.
 */
export function buildSupervisorFeedback(verdict: SupervisorVerdict): string {
  const lines = [FEEDBACK_START];
  if (verdict.flags.length > 0) {
    lines.push('Flags:');
    for (const flag of verdict.flags) {
      // Flatten newlines first, then sanitize — prevents split-sentinel bypass.
      const flat = flag.replace(/\s*\n\s*/g, ' ').trim();
      const cleaned = sanitizeFeedbackText(flat);
      if (cleaned) lines.push(`- ${cleaned}`);
    }
  }
  if (verdict.recommendation) {
    // Flatten newlines first, then sanitize — prevents split-sentinel bypass.
    const flat = verdict.recommendation.replace(/\s*\n\s*/g, ' ').trim();
    lines.push(`Recommendation: ${sanitizeFeedbackText(flat)}`);
  }
  lines.push(FEEDBACK_END);
  return lines.join('\n');
}
