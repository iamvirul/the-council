import { describe, it, expect } from 'vitest';
import {
  ChancellorResponseSchema,
  ExecutorResponseSchema,
  AideResponseSchema,
  SupervisorVerdictSchema,
} from '../../src/domain/models/schemas.js';

// Domain schemas are the primary defense against malformed or adversarial agent
// responses. Cap enforcement (string and array lengths) is explicitly called out
// in the source as a prompt-injection amplification mitigation, so every cap
// gets an explicit "just over the limit" rejection test.

// ─── Chancellor ───────────────────────────────────────────────────────────────

describe('ChancellorResponseSchema', () => {
  const valid = {
    analysis: 'a',
    key_insights: ['i'],
    plan: [
      {
        id: 's',
        description: 'd',
        assignee: 'executor',
        dependencies: [],
        complexity: 'low',
        success_criteria: 'ok',
      },
    ],
    risks: [],
    assumptions: [],
    success_metrics: [],
    delegation_strategy: 'direct',
    recommendations: [],
  };

  it('accepts a minimal valid payload', () => {
    expect(() => ChancellorResponseSchema.parse(valid)).not.toThrow();
  });

  it('rejects plan[].assignee outside the enum', () => {
    expect(() =>
      ChancellorResponseSchema.parse({
        ...valid,
        plan: [{ ...valid.plan[0], assignee: 'janitor' }],
      }),
    ).toThrow();
  });

  it('rejects plan[].complexity outside the enum', () => {
    expect(() =>
      ChancellorResponseSchema.parse({
        ...valid,
        plan: [{ ...valid.plan[0], complexity: 'extreme' }],
      }),
    ).toThrow();
  });

  it('rejects > 20 plan entries', () => {
    const oversized = Array.from({ length: 21 }, () => valid.plan[0]);
    expect(() => ChancellorResponseSchema.parse({ ...valid, plan: oversized })).toThrow();
  });

  it('rejects analysis over 10 000 characters', () => {
    expect(() =>
      ChancellorResponseSchema.parse({ ...valid, analysis: 'a'.repeat(10_001) }),
    ).toThrow();
  });

  it('rejects missing required fields', () => {
    const { delegation_strategy, ...stripped } = valid;
    expect(() => ChancellorResponseSchema.parse(stripped)).toThrow();
  });
});

// ─── Executor ─────────────────────────────────────────────────────────────────

describe('ExecutorResponseSchema', () => {
  const valid = {
    status: 'completed',
    step_id: 's',
    what_was_done: 'x',
    result: 'r',
    delegated_tasks: [],
    blockers: [],
    quality_assessment: 'ok',
  };

  it('accepts a minimal valid payload', () => {
    expect(() => ExecutorResponseSchema.parse(valid)).not.toThrow();
  });

  it('accepts all four status values', () => {
    for (const status of ['completed', 'delegated', 'blocked', 'in_progress']) {
      expect(() => ExecutorResponseSchema.parse({ ...valid, status })).not.toThrow();
    }
  });

  it('rejects unknown status', () => {
    expect(() => ExecutorResponseSchema.parse({ ...valid, status: 'pending' })).toThrow();
  });

  it('rejects > 10 delegated_tasks (prompt-injection amplification cap)', () => {
    const oversized = Array.from({ length: 11 }, (_, i) => ({
      task_id: `t-${i}`,
      description: 'd',
      status: 'pending' as const,
    }));
    expect(() =>
      ExecutorResponseSchema.parse({ ...valid, delegated_tasks: oversized }),
    ).toThrow();
  });

  it('rejects delegated_tasks[].description over 2 000 chars', () => {
    const oversized = [
      { task_id: 't-1', description: 'd'.repeat(2_001), status: 'pending' as const },
    ];
    expect(() =>
      ExecutorResponseSchema.parse({ ...valid, delegated_tasks: oversized }),
    ).toThrow();
  });

  it('rejects result over 20 000 chars', () => {
    expect(() => ExecutorResponseSchema.parse({ ...valid, result: 'r'.repeat(20_001) })).toThrow();
  });

  it('accepts optional next_step when present', () => {
    expect(() => ExecutorResponseSchema.parse({ ...valid, next_step: 'go' })).not.toThrow();
  });
});

// ─── Aide ─────────────────────────────────────────────────────────────────────

describe('AideResponseSchema', () => {
  const valid = {
    task_id: 't',
    status: 'completed',
    result: 'r',
    approach: 'a',
    quality_check: { meets_criteria: true, notes: '' },
  };

  it('accepts a minimal valid payload', () => {
    expect(() => AideResponseSchema.parse(valid)).not.toThrow();
  });

  it('rejects unknown status', () => {
    expect(() => AideResponseSchema.parse({ ...valid, status: 'partial' })).toThrow();
  });

  it('rejects non-boolean quality_check.meets_criteria', () => {
    expect(() =>
      AideResponseSchema.parse({
        ...valid,
        quality_check: { meets_criteria: 'true', notes: '' },
      }),
    ).toThrow();
  });

  it('rejects result over 10 000 chars', () => {
    expect(() => AideResponseSchema.parse({ ...valid, result: 'r'.repeat(10_001) })).toThrow();
  });
});

// ─── Supervisor ───────────────────────────────────────────────────────────────

describe('SupervisorVerdictSchema', () => {
  const valid = {
    subject: 's',
    subject_type: 'executor_step',
    approved: true,
    confidence: 'high',
    flags: [],
    recommendation: '',
  };

  it('accepts a minimal valid payload', () => {
    expect(() => SupervisorVerdictSchema.parse(valid)).not.toThrow();
  });

  it('accepts both subject_type values', () => {
    for (const subject_type of ['executor_step', 'aide_task']) {
      expect(() => SupervisorVerdictSchema.parse({ ...valid, subject_type })).not.toThrow();
    }
  });

  it('rejects subject_type outside the enum', () => {
    expect(() =>
      SupervisorVerdictSchema.parse({ ...valid, subject_type: 'chancellor_plan' }),
    ).toThrow();
  });

  it('rejects > 10 flags (log-flood cap)', () => {
    const oversized = Array.from({ length: 11 }, () => 'flag');
    expect(() => SupervisorVerdictSchema.parse({ ...valid, flags: oversized })).toThrow();
  });

  it('rejects individual flag over 500 chars', () => {
    expect(() => SupervisorVerdictSchema.parse({ ...valid, flags: ['x'.repeat(501)] })).toThrow();
  });

  it('rejects recommendation over 2 000 chars', () => {
    expect(() =>
      SupervisorVerdictSchema.parse({ ...valid, recommendation: 'y'.repeat(2_001) }),
    ).toThrow();
  });
});
