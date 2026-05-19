// Tests for buildResultSummary — specifically the Quality Summary section,
// which is the observable output of the scoring and ranking feature.
//
// buildResultSummary is tested in isolation by constructing minimal CouncilSession
// stubs and asserting on the rendered Markdown string.

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock infra dependencies pulled in transitively by orchestrator/index.ts.
vi.mock('../../../src/application/chancellor/agent.js', () => ({
  invokeChancellor: vi.fn(),
  invokeChancellorCoherence: vi.fn(),
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

import { buildResultSummary } from '../../../src/application/orchestrator/index.js';
import type { CouncilSession, SupervisorVerdict } from '../../../src/domain/models/types.js';

beforeEach(() => {
  vi.clearAllMocks();
});

function makeSession(overrides: Partial<CouncilSession> = {}): CouncilSession {
  return {
    request_id: 'test-id',
    created_at: new Date().toISOString(),
    problem: 'test problem',
    phase: 'complete',
    executor_progress: {
      completed_steps: [],
      results: [],
      step_failures: [],
    },
    aide_results: [],
    supervisor_verdicts: [],
    metrics: {
      total_agent_calls: 0,
      agents_invoked: [],
      eval_retries: 0,
    },
    ...overrides,
  };
}

function makeVerdict(subject: string, score: number | undefined, approved = true, flags: string[] = []): SupervisorVerdict {
  return {
    subject,
    subject_type: 'executor_step',
    approved,
    confidence: 'high',
    score,
    flags,
    recommendation: '',
  };
}

describe('buildResultSummary — Quality Summary section', () => {
  it('omits Quality Summary when there are no verdicts', () => {
    const out = buildResultSummary(makeSession(), Date.now());
    expect(out).not.toContain('## Quality Summary');
  });

  it('renders Quality Summary with avg/min scores when verdicts carry scores', () => {
    const session = makeSession({
      supervisor_verdicts: [
        makeVerdict('step-1', 80),
        makeVerdict('step-2', 60),
      ],
    });
    const out = buildResultSummary(session, Date.now());
    expect(out).toContain('## Quality Summary');
    expect(out).toContain('Average score: **70/100**');
    expect(out).toContain('Lowest: **60/100** (step-2)');
    expect(out).toContain('Flags raised: **0**');
  });

  it('renders flag count in Quality Summary even when scores are absent', () => {
    const session = makeSession({
      supervisor_verdicts: [
        makeVerdict('step-1', undefined, false, ['missing tests', 'no error handling']),
      ],
    });
    const out = buildResultSummary(session, Date.now());
    expect(out).toContain('## Quality Summary');
    expect(out).toContain('score unavailable');
    expect(out).toContain('Flags raised: **2**');
    expect(out).not.toContain('Average score:');
  });

  it('includes flags in Quality Summary total', () => {
    const session = makeSession({
      supervisor_verdicts: [
        makeVerdict('step-1', 75, true, ['minor issue']),
        makeVerdict('step-2', 90, true, []),
      ],
    });
    const out = buildResultSummary(session, Date.now());
    expect(out).toContain('Flags raised: **1**');
  });

  it('does not render score-gate line when MIN_SCORE is 0 (default in tests)', () => {
    // MIN_SCORE defaults to 0 in tests (no env var). Gate line must be absent.
    const session = makeSession({
      supervisor_verdicts: [makeVerdict('step-1', 40)],
    });
    const out = buildResultSummary(session, Date.now());
    expect(out).toContain('## Quality Summary');
    expect(out).not.toContain('Score-gate threshold');
  });
});
