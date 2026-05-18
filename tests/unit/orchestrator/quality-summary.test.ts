import { describe, it, expect } from 'vitest';
import { computeQualitySummary } from '../../../src/application/orchestrator/quality.js';
import type { SupervisorVerdict } from '../../../src/domain/models/types.js';

function verdict(subject: string, score: number | undefined, flags: string[] = []): SupervisorVerdict {
  return {
    subject,
    subject_type: 'executor_step',
    approved: score === undefined || score >= 70,
    confidence: 'high',
    score,
    flags,
    recommendation: '',
  };
}

describe('computeQualitySummary', () => {
  it('returns null when there are no verdicts', () => {
    expect(computeQualitySummary([])).toBeNull();
  });

  it('returns correct metrics for a single verdict', () => {
    const result = computeQualitySummary([verdict('step-1', 80)]);
    expect(result).toEqual({
      avg_score: 80,
      min_score: 80,
      min_score_subject: 'step-1',
      total_flags: 0,
    });
  });

  it('computes correct average across multiple verdicts', () => {
    const result = computeQualitySummary([
      verdict('step-1', 90),
      verdict('step-2', 70),
      verdict('step-3', 80),
    ]);
    expect(result?.avg_score).toBe(80);
  });

  it('rounds the average score to the nearest integer', () => {
    // (90 + 80 + 75) / 3 = 81.666… → rounds to 82
    const result = computeQualitySummary([
      verdict('step-1', 90),
      verdict('step-2', 80),
      verdict('step-3', 75),
    ]);
    expect(result?.avg_score).toBe(82);
  });

  it('identifies the lowest-scoring subject', () => {
    const result = computeQualitySummary([
      verdict('step-1', 90),
      verdict('step-2', 45),
      verdict('step-3', 80),
    ]);
    expect(result?.min_score).toBe(45);
    expect(result?.min_score_subject).toBe('step-2');
  });

  it('sums flags across all verdicts', () => {
    const result = computeQualitySummary([
      verdict('step-1', 90, ['flag-a']),
      verdict('step-2', 60, ['flag-b', 'flag-c']),
      verdict('step-3', 80, []),
    ]);
    expect(result?.total_flags).toBe(3);
  });

  it('returns total_flags=0 when no verdict has flags', () => {
    const result = computeQualitySummary([verdict('step-1', 85), verdict('step-2', 70)]);
    expect(result?.total_flags).toBe(0);
  });

  it('handles a perfect-score session', () => {
    const result = computeQualitySummary([verdict('step-1', 100), verdict('step-2', 100)]);
    expect(result).toEqual({
      avg_score: 100,
      min_score: 100,
      min_score_subject: 'step-1',
      total_flags: 0,
    });
  });

  it('handles a zero-score verdict', () => {
    const result = computeQualitySummary([verdict('step-1', 0), verdict('step-2', 80)]);
    expect(result?.min_score).toBe(0);
    expect(result?.min_score_subject).toBe('step-1');
    expect(result?.avg_score).toBe(40);
  });

  it('returns sentinel (-1) scores when no verdicts carry a score', () => {
    const result = computeQualitySummary([
      verdict('step-1', undefined, ['flag-a']),
      verdict('step-2', undefined),
    ]);
    expect(result).not.toBeNull();
    expect(result?.avg_score).toBe(-1);
    expect(result?.min_score).toBe(-1);
    expect(result?.total_flags).toBe(1);
  });

  it('counts flags from unscored verdicts alongside scored ones', () => {
    const result = computeQualitySummary([
      verdict('step-1', 80, ['flag-a']),
      verdict('step-2', undefined, ['flag-b', 'flag-c']),
    ]);
    // avg/min only cover the scored verdict
    expect(result?.avg_score).toBe(80);
    expect(result?.total_flags).toBe(3);
  });
});
