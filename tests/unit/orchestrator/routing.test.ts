import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import type {
  ExecutorResponse,
  AideResponse,
  SupervisorVerdict,
  ChancellorResponse,
} from '../../../src/domain/models/types.js';

// Mocks must be declared before the orchestrator imports them.
vi.mock('../../../src/application/chancellor/agent.js', () => ({
  invokeChancellor: vi.fn(),
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

import { invokeChancellor } from '../../../src/application/chancellor/agent.js';
import { invokeExecutor } from '../../../src/application/executor/agent.js';
import { invokeAide } from '../../../src/application/aide/agent.js';
import { invokeSupervisor } from '../../../src/application/supervisor/agent.js';
import { orchestrate } from '../../../src/application/orchestrator/index.js';

const mockedChancellor = invokeChancellor as unknown as Mock;
const mockedExecutor = invokeExecutor as unknown as Mock;
const mockedAide = invokeAide as unknown as Mock;
const mockedSupervisor = invokeSupervisor as unknown as Mock;

// ─── Factories ────────────────────────────────────────────────────────────────

function makePlan(): ChancellorResponse {
  return {
    analysis: 'deep analysis',
    key_insights: [],
    plan: [
      {
        id: 'plan-step-1',
        description: 'first step',
        assignee: 'executor',
        dependencies: [],
        complexity: 'medium',
        success_criteria: 'done',
      },
      {
        id: 'plan-step-2',
        description: 'second step',
        assignee: 'executor',
        dependencies: [],
        complexity: 'low',
        success_criteria: 'done',
      },
    ],
    risks: [],
    assumptions: [],
    success_metrics: [],
    delegation_strategy: 'direct',
    recommendations: [],
  };
}

function makeExec(
  stepId: string,
  delegated: ExecutorResponse['delegated_tasks'] = [],
): ExecutorResponse {
  return {
    status: 'completed',
    step_id: stepId,
    what_was_done: 'stub',
    result: `exec-${stepId}`,
    delegated_tasks: delegated,
    blockers: [],
    quality_assessment: 'ok',
  };
}

function makeAideResp(taskId: string): AideResponse {
  return {
    task_id: taskId,
    status: 'completed',
    result: `aide-${taskId}`,
    approach: 'stub',
    quality_check: { meets_criteria: true, notes: '' },
  };
}

function approve(id: string, subjectType: 'executor_step' | 'aide_task'): SupervisorVerdict {
  return {
    subject: id,
    subject_type: subjectType,
    approved: true,
    confidence: 'high',
    flags: [],
    recommendation: '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Approve-all Supervisor: tests exercise routing, not the eval loop.
  mockedSupervisor.mockImplementation(async (p: { subject_id: string; subject_type: 'executor_step' | 'aide_task' }) =>
    approve(p.subject_id, p.subject_type),
  );
});

// ─── Trivial path: single Aide call ──────────────────────────────────────────

describe('orchestrate — trivial complexity', () => {
  it('routes "format" to Aide only and skips Chancellor + Executor', async () => {
    mockedAide.mockResolvedValueOnce(makeAideResp('trivial-task'));

    const out = await orchestrate('format this JSON');
    expect(out.complexity).toBe('trivial');
    expect(mockedChancellor).not.toHaveBeenCalled();
    expect(mockedExecutor).not.toHaveBeenCalled();
    expect(mockedAide).toHaveBeenCalledTimes(1);
    expect(out.result).toBe('aide-trivial-task');
  });

  it('matches every trivial keyword (format, convert, transform, clean, list, count)', async () => {
    for (const kw of ['format', 'convert', 'transform', 'clean', 'list', 'count']) {
      mockedAide.mockResolvedValueOnce(makeAideResp('t'));
      const out = await orchestrate(`${kw} this`);
      expect(out.complexity).toBe('trivial');
    }
  });
});

// ─── Simple path: Executor (+ delegated Aides) ───────────────────────────────

describe('orchestrate — simple complexity', () => {
  it('routes to Executor without invoking Chancellor', async () => {
    mockedExecutor.mockResolvedValueOnce(makeExec('step-1'));

    const out = await orchestrate('add a retry to the fetch helper');
    expect(out.complexity).toBe('simple');
    expect(mockedChancellor).not.toHaveBeenCalled();
    expect(mockedExecutor).toHaveBeenCalledTimes(1);
  });

  it('invokes Aide for every pending delegated_task returned by the Executor', async () => {
    mockedExecutor.mockResolvedValueOnce(
      makeExec('step-1', [
        { task_id: 'sub-1', description: 'format output', status: 'pending' },
        { task_id: 'sub-2', description: 'clean input', status: 'pending' },
      ]),
    );
    mockedAide.mockResolvedValue(makeAideResp('sub'));

    await orchestrate('add a retry to the fetch helper');
    expect(mockedAide).toHaveBeenCalledTimes(2);
  });

  it('skips delegated_tasks marked as already completed', async () => {
    mockedExecutor.mockResolvedValueOnce(
      makeExec('step-1', [
        { task_id: 'sub-1', description: 'already done', status: 'completed' },
        { task_id: 'sub-2', description: 'still pending', status: 'pending' },
      ]),
    );
    mockedAide.mockResolvedValueOnce(makeAideResp('sub-2'));

    await orchestrate('add a retry to the fetch helper');
    expect(mockedAide).toHaveBeenCalledTimes(1);
    expect(mockedAide.mock.calls[0]?.[0]).toBe('sub-2');
  });
});

// ─── Complex path: Chancellor → Executor(s) → Aide(s) ────────────────────────

describe('orchestrate — complex complexity', () => {
  it('routes to Chancellor, then Executor once per plan step', async () => {
    mockedChancellor.mockResolvedValueOnce(makePlan());
    mockedExecutor
      .mockResolvedValueOnce(makeExec('plan-step-1'))
      .mockResolvedValueOnce(makeExec('plan-step-2'));

    const out = await orchestrate('design a microservices architecture');
    expect(out.complexity).toBe('complex');
    expect(mockedChancellor).toHaveBeenCalledTimes(1);
    expect(mockedExecutor).toHaveBeenCalledTimes(2);
  });

  it('feeds Chancellor plan + current step as context to each Executor call', async () => {
    mockedChancellor.mockResolvedValueOnce(makePlan());
    mockedExecutor
      .mockResolvedValueOnce(makeExec('plan-step-1'))
      .mockResolvedValueOnce(makeExec('plan-step-2'));

    await orchestrate('design a microservices architecture');

    const firstCall = mockedExecutor.mock.calls[0]?.[0];
    expect(firstCall.context).toContain('plan-step-1');
    expect(firstCall.problem).toBe('first step');
  });

  it('invokes Aide when a complex-path Executor delegates', async () => {
    mockedChancellor.mockResolvedValueOnce(makePlan());
    mockedExecutor
      .mockResolvedValueOnce(
        makeExec('plan-step-1', [
          { task_id: 'sub-1', description: 'format diagram', status: 'pending' },
        ]),
      )
      .mockResolvedValueOnce(makeExec('plan-step-2'));
    mockedAide.mockResolvedValueOnce(makeAideResp('sub-1'));

    await orchestrate('design a microservices architecture');
    expect(mockedAide).toHaveBeenCalledTimes(1);
  });

  it('continues to the next step when an Executor reports status=blocked', async () => {
    mockedChancellor.mockResolvedValueOnce(makePlan());
    const blocked: ExecutorResponse = {
      ...makeExec('plan-step-1'),
      status: 'blocked',
      blockers: ['missing creds'],
    };
    mockedExecutor
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(makeExec('plan-step-2'));

    await orchestrate('design a microservices architecture');
    expect(mockedExecutor).toHaveBeenCalledTimes(2);
  });

  it('triggers complex routing when word count exceeds 60', async () => {
    mockedChancellor.mockResolvedValueOnce(makePlan());
    mockedExecutor
      .mockResolvedValueOnce(makeExec('plan-step-1'))
      .mockResolvedValueOnce(makeExec('plan-step-2'));

    const longProblem = 'word '.repeat(61).trim();
    const out = await orchestrate(longProblem);
    expect(out.complexity).toBe('complex');
  });
});

// ─── Orchestration result shape ──────────────────────────────────────────────

describe('orchestrate — result contract', () => {
  it('returns a fresh request_id per call', async () => {
    mockedAide.mockResolvedValue(makeAideResp('t'));
    const a = await orchestrate('format this');
    const b = await orchestrate('format that');
    expect(a.request_id).not.toBe(b.request_id);
  });

  it('records the chancellor + executor + supervisor roles in agents_invoked for complex paths', async () => {
    mockedChancellor.mockResolvedValueOnce(makePlan());
    mockedExecutor
      .mockResolvedValueOnce(makeExec('plan-step-1'))
      .mockResolvedValueOnce(makeExec('plan-step-2'));

    const { session } = await orchestrate('design a microservices architecture');
    expect(session.metrics.agents_invoked).toEqual(
      expect.arrayContaining(['chancellor', 'executor', 'supervisor']),
    );
    expect(session.phase).toBe('complete');
    expect(session.metrics.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
