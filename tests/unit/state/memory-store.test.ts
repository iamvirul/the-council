import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../../../src/infra/state/stores/memory-store.js';
import { CouncilError } from '../../../src/domain/models/types.js';
import type {
  ChancellorResponse,
  ExecutorResponse,
  AideResponse,
  SupervisorVerdict,
} from '../../../src/domain/models/types.js';

function makeChancellorPlan(): ChancellorResponse {
  return {
    analysis: 'a',
    key_insights: [],
    plan: [],
    risks: [],
    assumptions: [],
    success_metrics: [],
    delegation_strategy: 'direct',
    recommendations: [],
  };
}

function makeExec(stepId: string, nextStep?: string): ExecutorResponse {
  return {
    status: 'completed',
    step_id: stepId,
    what_was_done: 'done',
    result: 'r',
    delegated_tasks: [],
    blockers: [],
    quality_assessment: 'ok',
    ...(nextStep ? { next_step: nextStep } : {}),
  };
}

function makeAide(taskId: string): AideResponse {
  return {
    task_id: taskId,
    status: 'completed',
    result: 'r',
    approach: 'a',
    quality_check: { meets_criteria: true, notes: '' },
  };
}

function makeVerdict(subject: string, approved: boolean): SupervisorVerdict {
  return {
    subject,
    subject_type: 'executor_step',
    approved,
    confidence: 'high',
    flags: [],
    recommendation: '',
  };
}

describe('MemoryStore — lifecycle', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('create() returns a fully-initialized session', () => {
    const s = store.create('problem X');
    expect(s.problem).toBe('problem X');
    expect(s.phase).toBe('planning');
    expect(s.executor_progress).toEqual({ completed_steps: [], results: [] });
    expect(s.aide_results).toEqual([]);
    expect(s.supervisor_verdicts).toEqual([]);
    expect(s.metrics).toEqual({
      total_agent_calls: 0,
      agents_invoked: [],
      eval_retries: 0,
    });
    expect(typeof s.request_id).toBe('string');
    expect(s.request_id).toHaveLength(36);
  });

  it('get() throws SESSION_NOT_FOUND for unknown ids', () => {
    expect(() => store.get('does-not-exist')).toThrow(CouncilError);
    try {
      store.get('does-not-exist');
    } catch (err) {
      expect(err).toBeInstanceOf(CouncilError);
      expect((err as CouncilError).code).toBe('SESSION_NOT_FOUND');
    }
  });

  it('getOptional() returns undefined for unknown ids instead of throwing', () => {
    expect(store.getOptional('does-not-exist')).toBeUndefined();
  });

  it('delete() removes a session', () => {
    const s = store.create('p');
    store.delete(s.request_id);
    expect(store.getOptional(s.request_id)).toBeUndefined();
  });

  it('list() returns all live sessions', () => {
    const a = store.create('A');
    const b = store.create('B');
    const ids = store.list().map(s => s.request_id);
    expect(ids).toContain(a.request_id);
    expect(ids).toContain(b.request_id);
    expect(store.list()).toHaveLength(2);
  });
});

describe('MemoryStore — state mutations', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('setPhase() updates the phase', () => {
    const s = store.create('p');
    store.setPhase(s.request_id, 'executing');
    expect(store.get(s.request_id).phase).toBe('executing');
  });

  it('setChancellorPlan() stores the plan', () => {
    const s = store.create('p');
    store.setChancellorPlan(s.request_id, makeChancellorPlan());
    expect(store.get(s.request_id).chancellor_plan?.analysis).toBe('a');
  });

  it('setCurrentStep() updates executor_progress.current_step', () => {
    const s = store.create('p');
    store.setCurrentStep(s.request_id, 'step-7');
    expect(store.get(s.request_id).executor_progress.current_step).toBe('step-7');
  });

  it('recordAgentCall() increments total_agent_calls on every call', () => {
    const s = store.create('p');
    store.recordAgentCall(s.request_id, 'executor');
    store.recordAgentCall(s.request_id, 'executor');
    store.recordAgentCall(s.request_id, 'aide');
    expect(store.get(s.request_id).metrics.total_agent_calls).toBe(3);
  });

  it('recordAgentCall() deduplicates agents_invoked', () => {
    const s = store.create('p');
    store.recordAgentCall(s.request_id, 'executor');
    store.recordAgentCall(s.request_id, 'executor');
    store.recordAgentCall(s.request_id, 'aide');
    expect(store.get(s.request_id).metrics.agents_invoked).toEqual(['executor', 'aide']);
  });

  it('recordExecutorResult() appends result, updates completed_steps, propagates next_step', () => {
    const s = store.create('p');
    store.recordExecutorResult(s.request_id, makeExec('step-1', 'step-2'));
    const after = store.get(s.request_id);
    expect(after.executor_progress.results).toHaveLength(1);
    expect(after.executor_progress.completed_steps).toEqual(['step-1']);
    expect(after.executor_progress.current_step).toBe('step-2');
  });

  it('recordAideResult() appends to aide_results', () => {
    const s = store.create('p');
    store.recordAideResult(s.request_id, makeAide('t-1'));
    store.recordAideResult(s.request_id, makeAide('t-2'));
    expect(store.get(s.request_id).aide_results.map(r => r.task_id)).toEqual(['t-1', 't-2']);
  });

  it('recordSupervisorVerdict() appends to supervisor_verdicts', () => {
    const s = store.create('p');
    store.recordSupervisorVerdict(s.request_id, makeVerdict('step-1', true));
    store.recordSupervisorVerdict(s.request_id, makeVerdict('step-2', false));
    const verdicts = store.get(s.request_id).supervisor_verdicts;
    expect(verdicts).toHaveLength(2);
    expect(verdicts[1]?.approved).toBe(false);
  });

  it('recordCavemanMode() sets metrics.caveman_mode', () => {
    const s = store.create('p');
    store.recordCavemanMode(s.request_id, 'full');
    expect(store.get(s.request_id).metrics.caveman_mode).toBe('full');
  });

  it('complete() sets phase=complete and records duration_ms', () => {
    const s = store.create('p');
    const started = Date.now() - 100;
    store.complete(s.request_id, started);
    const after = store.get(s.request_id);
    expect(after.phase).toBe('complete');
    expect(after.metrics.duration_ms).toBeGreaterThanOrEqual(100);
  });

  it('fail() sets phase=failed and records duration_ms', () => {
    const s = store.create('p');
    store.fail(s.request_id, Date.now() - 10);
    const after = store.get(s.request_id);
    expect(after.phase).toBe('failed');
    expect(after.metrics.duration_ms).toBeGreaterThanOrEqual(10);
  });
});

describe('MemoryStore — LRU eviction', () => {
  it('bounds the store at MAX_SESSIONS by evicting the oldest entry', () => {
    // Private constant; value asserted here must match memory-store.ts.
    const MAX = 500;
    const store = new MemoryStore();
    const first = store.create('first');

    for (let i = 0; i < MAX - 1; i++) store.create(`p-${i}`);
    // At MAX now — the next create should evict the oldest (first).
    expect(store.list()).toHaveLength(MAX);

    store.create('over-the-limit');
    expect(store.list()).toHaveLength(MAX);
    expect(store.getOptional(first.request_id)).toBeUndefined();
  });

  it('get() refreshes the LRU position so recent access survives eviction', () => {
    const MAX = 500;
    const store = new MemoryStore();
    const first = store.create('first');
    const second = store.create('second');

    for (let i = 0; i < MAX - 2; i++) store.create(`p-${i}`);

    // Touch `first` so it is no longer the oldest.
    store.get(first.request_id);

    store.create('forces-eviction');

    expect(store.getOptional(first.request_id)).toBeDefined();
    // `second` was the next-oldest after `first` was refreshed.
    expect(store.getOptional(second.request_id)).toBeUndefined();
  });
});
