import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import type {
  ChancellorResponse,
  PlanCritiqueResponse,
} from '../../../src/domain/models/types.js';

// vi.mock() is hoisted — must include ALL exports consumed by the module under test.
vi.mock('../../../src/application/chancellor/agent.js', () => ({
  invokeChancellor: vi.fn(),
  invokeChancellorCoherence: vi.fn().mockResolvedValue({
    coherent: true,
    assessment: 'stub',
    gaps: [],
    recommendations: [],
  }),
  invokeChancellorCritic: vi.fn(),
}));
vi.mock('../../../src/application/executor/agent.js', () => ({
  invokeExecutor: vi.fn(),
}));
vi.mock('../../../src/application/aide/agent.js', () => ({
  invokeAide: vi.fn(),
}));
vi.mock('../../../src/application/supervisor/agent.js', () => ({
  invokeSupervisor: vi.fn(),
}));

import { invokeChancellor, invokeChancellorCritic } from '../../../src/application/chancellor/agent.js';
import { invokeExecutor } from '../../../src/application/executor/agent.js';
import { invokeSupervisor } from '../../../src/application/supervisor/agent.js';
import { orchestrate } from '../../../src/application/orchestrator/index.js';
import { stateStore } from '../../../src/infra/state/council-state.js';

const mockedInvokeChancellor = invokeChancellor as unknown as Mock;
const mockedInvokeChancellorCritic = invokeChancellorCritic as unknown as Mock;
const mockedInvokeExecutor = invokeExecutor as unknown as Mock;
const mockedInvokeSupervisor = invokeSupervisor as unknown as Mock;

// ─── Factories ────────────────────────────────────────────────────────────────

function makePlan(stepCount = 1): ChancellorResponse {
  return {
    analysis: 'test analysis',
    key_insights: [],
    plan: Array.from({ length: stepCount }, (_, i) => ({
      id: `step-${i + 1}`,
      description: `Step ${i + 1}`,
      assignee: 'executor' as const,
      dependencies: [],
      complexity: 'medium' as const,
      success_criteria: 'done',
    })),
    risks: [],
    assumptions: [],
    success_metrics: [],
    delegation_strategy: 'direct',
    recommendations: [],
  };
}

function makeCritique(overrides: Partial<PlanCritiqueResponse> = {}): PlanCritiqueResponse {
  return {
    critique: 'Plan looks reasonable',
    gaps: [],
    improvements: [],
    overall_quality: 'good',
    requires_revision: false,
    ...overrides,
  };
}

function makeExecResult(stepId: string) {
  return {
    status: 'completed' as const,
    step_id: stepId,
    what_was_done: 'done',
    result: 'result',
    delegated_tasks: [],
    blockers: [],
    quality_assessment: 'ok',
  };
}

function approvedVerdict(subject: string) {
  return {
    subject,
    subject_type: 'executor_step' as const,
    approved: true,
    confidence: 'high' as const,
    score: 90,
    flags: [],
    recommendation: '',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wire mocks for a minimal complex-path orchestration with debate. */
function setupComplexOrchestration(stepIds: string[], debateRounds = 1) {
  // Chancellor returns the initial plan on the first call; revised plans on subsequent calls.
  const initialPlan = makePlan(stepIds.length);
  const revisedPlan = { ...makePlan(stepIds.length), analysis: 'revised analysis' };

  mockedInvokeChancellor
    .mockResolvedValueOnce(initialPlan) // initial plan
    .mockResolvedValue(revisedPlan);    // revisions (if any)

  // Executor returns a result for each step.
  for (const id of stepIds) {
    mockedInvokeExecutor.mockResolvedValueOnce(makeExecResult(id));
  }

  // Supervisor approves everything.
  mockedInvokeSupervisor.mockResolvedValue(approvedVerdict(stepIds[0] ?? 'step-1'));

  return { initialPlan, revisedPlan };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Debate loop — disabled (DEBATE_ROUNDS=0)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('does not invoke the critic when debate is off', async () => {
    // The DEBATE_ROUNDS module constant is evaluated once at import time.
    // In the test environment it resolves to 0 (no COUNCIL_DEBATE_ROUNDS env var).
    setupComplexOrchestration(['step-1']);
    // Use a complex-sounding problem so the complexity heuristic picks 'complex'.
    await orchestrate('Please analyze and design an architecture strategy for the system');

    expect(mockedInvokeChancellorCritic).not.toHaveBeenCalled();
    // Chancellor called exactly once (initial plan only).
    expect(mockedInvokeChancellor).toHaveBeenCalledTimes(1);
  });
});

describe('Debate loop — state recording', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('recordDebateRound stores round data on the session', async () => {
    const session = stateStore.create('test debate');
    const critique = makeCritique({ requires_revision: false, overall_quality: 'excellent' });
    stateStore.recordDebateRound(session.request_id, { round: 1, critique, revised_steps: 2 });

    const after = stateStore.get(session.request_id);
    expect(after.debate_rounds).toHaveLength(1);
    expect(after.debate_rounds?.[0]?.round).toBe(1);
    expect(after.debate_rounds?.[0]?.critique.overall_quality).toBe('excellent');
    expect(after.debate_rounds?.[0]?.revised_steps).toBe(2);
    expect(after.metrics.debate_rounds_completed).toBe(1);
  });

  it('recordDebateRound increments debate_rounds_completed across multiple rounds', async () => {
    const session = stateStore.create('test debate multi');
    stateStore.recordDebateRound(session.request_id, { round: 1, critique: makeCritique({ requires_revision: true }), revised_steps: 3 });
    stateStore.recordDebateRound(session.request_id, { round: 2, critique: makeCritique({ requires_revision: false }), revised_steps: 3 });

    const after = stateStore.get(session.request_id);
    expect(after.debate_rounds).toHaveLength(2);
    expect(after.metrics.debate_rounds_completed).toBe(2);
  });

  it('debate_rounds starts as undefined on a fresh session', () => {
    const session = stateStore.create('fresh');
    expect(session.debate_rounds).toBeUndefined();
    expect(session.metrics.debate_rounds_completed).toBeUndefined();
  });
});

describe('PlanCritiqueResponse schema', () => {
  // Import the schema directly to test boundary validation independently
  // of the agent invocation machinery.
  it('accepts a valid critique payload', async () => {
    const { PlanCritiqueSchema } = await import('../../../src/domain/models/schemas.js');
    expect(() =>
      PlanCritiqueSchema.parse({
        critique: 'Looks good',
        gaps: [],
        improvements: [],
        overall_quality: 'good',
        requires_revision: false,
      }),
    ).not.toThrow();
  });

  it('rejects overall_quality outside the enum', async () => {
    const { PlanCritiqueSchema } = await import('../../../src/domain/models/schemas.js');
    expect(() =>
      PlanCritiqueSchema.parse({
        critique: 'x',
        gaps: [],
        improvements: [],
        overall_quality: 'perfect',
        requires_revision: false,
      }),
    ).toThrow();
  });

  it('rejects non-boolean requires_revision', async () => {
    const { PlanCritiqueSchema } = await import('../../../src/domain/models/schemas.js');
    expect(() =>
      PlanCritiqueSchema.parse({
        critique: 'x',
        gaps: [],
        improvements: [],
        overall_quality: 'adequate',
        requires_revision: 'yes',
      }),
    ).toThrow();
  });

  it('rejects critique over 5000 chars', async () => {
    const { PlanCritiqueSchema } = await import('../../../src/domain/models/schemas.js');
    expect(() =>
      PlanCritiqueSchema.parse({
        critique: 'x'.repeat(5_001),
        gaps: [],
        improvements: [],
        overall_quality: 'adequate',
        requires_revision: false,
      }),
    ).toThrow();
  });

  it('rejects > 20 gaps (log-flood cap)', async () => {
    const { PlanCritiqueSchema } = await import('../../../src/domain/models/schemas.js');
    const oversizedGaps = Array.from({ length: 21 }, () => 'gap');
    expect(() =>
      PlanCritiqueSchema.parse({
        critique: 'x',
        gaps: oversizedGaps,
        improvements: [],
        overall_quality: 'poor',
        requires_revision: true,
      }),
    ).toThrow();
  });

  it('accepts all four overall_quality values', async () => {
    const { PlanCritiqueSchema } = await import('../../../src/domain/models/schemas.js');
    for (const overall_quality of ['poor', 'adequate', 'good', 'excellent']) {
      expect(() =>
        PlanCritiqueSchema.parse({
          critique: 'x',
          gaps: [],
          improvements: [],
          overall_quality,
          requires_revision: true,
        }),
      ).not.toThrow();
    }
  });
});
