import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import type {
  SupervisorVerdict,
  ExecutorResponse,
  AideResponse,
} from '../../../src/domain/models/types.js';

// Mocks must be declared before any imports that transitively load these modules.
// vitest hoists vi.mock() above imports automatically.
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

import { invokeExecutor } from '../../../src/application/executor/agent.js';
import { invokeAide } from '../../../src/application/aide/agent.js';
import { invokeSupervisor } from '../../../src/application/supervisor/agent.js';
import {
  runExecutorWithEval,
  runAideWithEval,
} from '../../../src/application/orchestrator/index.js';
import { stateStore } from '../../../src/infra/state/council-state.js';

const mockedInvokeExecutor = invokeExecutor as unknown as Mock;
const mockedInvokeAide = invokeAide as unknown as Mock;
const mockedInvokeSupervisor = invokeSupervisor as unknown as Mock;

// ─── Factories ────────────────────────────────────────────────────────────────

function makeExec(stepId: string, overrides: Partial<ExecutorResponse> = {}): ExecutorResponse {
  return {
    status: 'completed',
    step_id: stepId,
    what_was_done: 'stub',
    result: `executor-result-${stepId}`,
    delegated_tasks: [],
    blockers: [],
    quality_assessment: 'ok',
    ...overrides,
  };
}

function makeAide(taskId: string, overrides: Partial<AideResponse> = {}): AideResponse {
  return {
    task_id: taskId,
    status: 'completed',
    result: `aide-result-${taskId}`,
    approach: 'stub',
    quality_check: { meets_criteria: true, notes: '' },
    ...overrides,
  };
}

function makeVerdict(
  subjectId: string,
  approved: boolean,
  opts: {
    flags?: string[];
    recommendation?: string;
    subject_type?: 'executor_step' | 'aide_task';
  } = {},
): SupervisorVerdict {
  return {
    subject: subjectId,
    subject_type: opts.subject_type ?? 'executor_step',
    approved,
    confidence: 'high',
    flags: opts.flags ?? [],
    recommendation: opts.recommendation ?? '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Executor loop ────────────────────────────────────────────────────────────

describe('runExecutorWithEval', () => {
  it('approved on first attempt: one invocation, no retries, result recorded', async () => {
    const session = stateStore.create('problem');

    mockedInvokeExecutor.mockResolvedValueOnce(makeExec('step-1'));
    mockedInvokeSupervisor.mockResolvedValueOnce(makeVerdict('step-1', true));

    const result = await runExecutorWithEval(
      session.request_id,
      'original problem',
      'step description',
      { problem: 'step description' },
      2,
    );

    expect(result.step_id).toBe('step-1');
    expect(mockedInvokeExecutor).toHaveBeenCalledTimes(1);
    expect(mockedInvokeSupervisor).toHaveBeenCalledTimes(1);

    const s = stateStore.get(session.request_id);
    expect(s.metrics.eval_retries).toBe(0);
    expect(s.executor_progress.results).toHaveLength(1);
    expect(s.executor_progress.results[0]?.step_id).toBe('step-1');
    expect(s.supervisor_verdicts).toHaveLength(1);
    expect(s.supervisor_verdicts[0]?.approved).toBe(true);
  });

  it('rejected then approved: re-invokes with feedback, records 1 retry, surfaces final', async () => {
    const session = stateStore.create('problem');

    mockedInvokeExecutor
      .mockResolvedValueOnce(makeExec('step-1', { result: 'first-attempt' }))
      .mockResolvedValueOnce(makeExec('step-1', { result: 'second-attempt' }));
    mockedInvokeSupervisor
      .mockResolvedValueOnce(
        makeVerdict('step-1', false, {
          flags: ['missing validation'],
          recommendation: 'validate inputs',
        }),
      )
      .mockResolvedValueOnce(makeVerdict('step-1', true));

    const result = await runExecutorWithEval(
      session.request_id,
      'original problem',
      'step description',
      { problem: 'step description' },
      2,
    );

    expect(result.result).toBe('second-attempt');
    expect(mockedInvokeExecutor).toHaveBeenCalledTimes(2);

    // First call has no feedback; second call has the flags embedded.
    const firstCallArgs = mockedInvokeExecutor.mock.calls[0]?.[0];
    const secondCallArgs = mockedInvokeExecutor.mock.calls[1]?.[0];
    expect(firstCallArgs.supervisor_feedback).toBeUndefined();
    expect(secondCallArgs.supervisor_feedback).toContain('missing validation');
    expect(secondCallArgs.supervisor_feedback).toContain('validate inputs');

    const s = stateStore.get(session.request_id);
    expect(s.metrics.eval_retries).toBe(1);
    // Only the final attempt's result is recorded — intermediate ones are dropped.
    expect(s.executor_progress.results).toHaveLength(1);
    expect(s.executor_progress.results[0]?.result).toBe('second-attempt');
    // Every verdict is recorded for audit.
    expect(s.supervisor_verdicts).toHaveLength(2);
  });

  it('exhausted budget: surfaces flagged result and records every rejection', async () => {
    const session = stateStore.create('problem');
    const maxRetries = 2;

    for (let i = 0; i <= maxRetries; i++) {
      mockedInvokeExecutor.mockResolvedValueOnce(makeExec('step-1'));
      mockedInvokeSupervisor.mockResolvedValueOnce(
        makeVerdict('step-1', false, { flags: [`flag-${i}`] }),
      );
    }

    const result = await runExecutorWithEval(
      session.request_id,
      'p',
      'd',
      { problem: 'd' },
      maxRetries,
    );

    // Flagged result is still returned — nothing is silently dropped.
    expect(result.step_id).toBe('step-1');
    expect(mockedInvokeExecutor).toHaveBeenCalledTimes(maxRetries + 1);
    expect(mockedInvokeSupervisor).toHaveBeenCalledTimes(maxRetries + 1);

    const s = stateStore.get(session.request_id);
    // Retries = attempts beyond the first (the first isn't a retry).
    expect(s.metrics.eval_retries).toBe(maxRetries);
    expect(s.supervisor_verdicts).toHaveLength(maxRetries + 1);
    expect(s.supervisor_verdicts.every(v => !v.approved)).toBe(true);
    expect(s.executor_progress.results).toHaveLength(1);
  });

  it('supervisor errors: treated as approved (non-blocking contract preserved)', async () => {
    const session = stateStore.create('problem');

    mockedInvokeExecutor.mockResolvedValueOnce(makeExec('step-1'));
    mockedInvokeSupervisor.mockRejectedValueOnce(new Error('supervisor crashed'));

    const result = await runExecutorWithEval(
      session.request_id,
      'p',
      'd',
      { problem: 'd' },
      2,
    );

    expect(result.step_id).toBe('step-1');
    expect(mockedInvokeExecutor).toHaveBeenCalledTimes(1);

    const s = stateStore.get(session.request_id);
    expect(s.metrics.eval_retries).toBe(0);
    expect(s.supervisor_verdicts).toHaveLength(0);
    expect(s.executor_progress.results).toHaveLength(1);
  });

  it('maxRetries=0 disables the loop and preserves advisory-only behaviour', async () => {
    const session = stateStore.create('problem');

    mockedInvokeExecutor.mockResolvedValueOnce(makeExec('step-1'));
    mockedInvokeSupervisor.mockResolvedValueOnce(
      makeVerdict('step-1', false, { flags: ['bad'] }),
    );

    const result = await runExecutorWithEval(
      session.request_id,
      'p',
      'd',
      { problem: 'd' },
      0,
    );

    expect(result.step_id).toBe('step-1');
    expect(mockedInvokeExecutor).toHaveBeenCalledTimes(1);

    const s = stateStore.get(session.request_id);
    expect(s.metrics.eval_retries).toBe(0);
    expect(s.supervisor_verdicts).toHaveLength(1);
    expect(s.supervisor_verdicts[0]?.approved).toBe(false);
  });

  it('increments total_agent_calls per invocation including retries', async () => {
    const session = stateStore.create('problem');

    mockedInvokeExecutor
      .mockResolvedValueOnce(makeExec('step-1'))
      .mockResolvedValueOnce(makeExec('step-1'));
    mockedInvokeSupervisor
      .mockResolvedValueOnce(makeVerdict('step-1', false, { flags: ['f'] }))
      .mockResolvedValueOnce(makeVerdict('step-1', true));

    const before = stateStore.get(session.request_id).metrics.total_agent_calls;
    await runExecutorWithEval(
      session.request_id,
      'p',
      'd',
      { problem: 'd' },
      2,
    );
    const after = stateStore.get(session.request_id).metrics.total_agent_calls;

    // 2 executor calls + 2 supervisor calls = 4 invocations total.
    expect(after - before).toBe(4);
  });
});

// ─── Aide loop ────────────────────────────────────────────────────────────────

describe('runAideWithEval', () => {
  it('approved on first attempt records single result and no retries', async () => {
    const session = stateStore.create('problem');

    mockedInvokeAide.mockResolvedValueOnce(makeAide('task-1'));
    mockedInvokeSupervisor.mockResolvedValueOnce(
      makeVerdict('task-1', true, { subject_type: 'aide_task' }),
    );

    const result = await runAideWithEval(
      session.request_id,
      'original',
      'task description',
      'task-1',
      { problem: 'task description' },
      2,
    );

    expect(result.task_id).toBe('task-1');
    expect(mockedInvokeAide).toHaveBeenCalledTimes(1);
    const s = stateStore.get(session.request_id);
    expect(s.metrics.eval_retries).toBe(0);
    expect(s.aide_results).toHaveLength(1);
  });

  it('rejected then approved: feedback injected into second attempt', async () => {
    const session = stateStore.create('problem');

    mockedInvokeAide
      .mockResolvedValueOnce(makeAide('task-1'))
      .mockResolvedValueOnce(makeAide('task-1'));
    mockedInvokeSupervisor
      .mockResolvedValueOnce(
        makeVerdict('task-1', false, {
          flags: ['incomplete'],
          recommendation: 'add edge cases',
          subject_type: 'aide_task',
        }),
      )
      .mockResolvedValueOnce(
        makeVerdict('task-1', true, { subject_type: 'aide_task' }),
      );

    await runAideWithEval(
      session.request_id,
      'original',
      'task description',
      'task-1',
      { problem: 'task description' },
      2,
    );

    expect(mockedInvokeAide).toHaveBeenCalledTimes(2);
    // invokeAide signature is (taskId, opts) — opts is the second arg.
    const secondOpts = mockedInvokeAide.mock.calls[1]?.[1];
    expect(secondOpts.supervisor_feedback).toContain('incomplete');
    expect(secondOpts.supervisor_feedback).toContain('add edge cases');

    const s = stateStore.get(session.request_id);
    expect(s.metrics.eval_retries).toBe(1);
    expect(s.aide_results).toHaveLength(1);
  });

  it('exhausted budget surfaces the flagged aide output', async () => {
    const session = stateStore.create('problem');
    const maxRetries = 1;

    for (let i = 0; i <= maxRetries; i++) {
      mockedInvokeAide.mockResolvedValueOnce(makeAide('task-1'));
      mockedInvokeSupervisor.mockResolvedValueOnce(
        makeVerdict('task-1', false, {
          flags: [`issue-${i}`],
          subject_type: 'aide_task',
        }),
      );
    }

    const result = await runAideWithEval(
      session.request_id,
      'p',
      'd',
      'task-1',
      { problem: 'd' },
      maxRetries,
    );

    expect(result.task_id).toBe('task-1');
    expect(mockedInvokeAide).toHaveBeenCalledTimes(maxRetries + 1);
    const s = stateStore.get(session.request_id);
    expect(s.metrics.eval_retries).toBe(maxRetries);
    expect(s.supervisor_verdicts).toHaveLength(maxRetries + 1);
  });
});
