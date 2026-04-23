import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { CouncilError } from '../../../src/domain/models/types.js';

vi.mock('../../../src/infra/agent-sdk/runner.js', () => ({
  runAgent: vi.fn(),
}));

import { runAgent } from '../../../src/infra/agent-sdk/runner.js';
import { invokeChancellor } from '../../../src/application/chancellor/agent.js';

const mockedRun = runAgent as unknown as Mock;

const VALID_RESPONSE = {
  analysis: 'deep analysis',
  key_insights: ['insight 1'],
  plan: [
    {
      id: 'step-1',
      description: 'do X',
      assignee: 'executor',
      dependencies: [],
      complexity: 'medium',
      success_criteria: 'X works',
    },
  ],
  risks: [],
  assumptions: [],
  success_metrics: [],
  delegation_strategy: 'direct',
  recommendations: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('invokeChancellor — parsing', () => {
  it('parses a valid raw JSON response', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    const r = await invokeChancellor({ problem: 'design Y' });
    expect(r.plan).toHaveLength(1);
    expect(r.plan[0]?.id).toBe('step-1');
  });

  it('extracts JSON from inside a ```json fence', async () => {
    mockedRun.mockResolvedValueOnce('```json\n' + JSON.stringify(VALID_RESPONSE) + '\n```');
    const r = await invokeChancellor({ problem: 'design Y' });
    expect(r.analysis).toBe('deep analysis');
  });

  it('throws INVALID_JSON_RESPONSE on malformed JSON', async () => {
    mockedRun.mockResolvedValueOnce('not json');
    await expect(invokeChancellor({ problem: 'design Y' })).rejects.toMatchObject({
      name: 'CouncilError',
      code: 'INVALID_JSON_RESPONSE',
      agent: 'chancellor',
    });
  });

  it('throws INVALID_JSON_RESPONSE when plan[i].assignee is invalid', async () => {
    const bad = {
      ...VALID_RESPONSE,
      plan: [{ ...VALID_RESPONSE.plan[0], assignee: 'janitor' }],
    };
    mockedRun.mockResolvedValueOnce(JSON.stringify(bad));
    await expect(invokeChancellor({ problem: 'design Y' })).rejects.toBeInstanceOf(CouncilError);
  });

  it('enforces the plan-length cap (Zod rejects > 20 steps)', async () => {
    const oversized = {
      ...VALID_RESPONSE,
      plan: Array.from({ length: 21 }, (_, i) => ({
        id: `step-${i}`,
        description: 'do X',
        assignee: 'executor' as const,
        dependencies: [],
        complexity: 'low' as const,
        success_criteria: 'ok',
      })),
    };
    mockedRun.mockResolvedValueOnce(JSON.stringify(oversized));
    await expect(invokeChancellor({ problem: 'design Y' })).rejects.toMatchObject({
      code: 'INVALID_JSON_RESPONSE',
    });
  });
});

describe('invokeChancellor — user message composition', () => {
  it('sends Problem-only message when no context is provided', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    await invokeChancellor({ problem: 'design Y' });
    const msg = mockedRun.mock.calls[0]?.[0].userMessage as string;
    expect(msg).toBe('Problem: design Y');
  });

  it('appends Context: when provided', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    await invokeChancellor({ problem: 'design Y', context: 'prior work notes' });
    const msg = mockedRun.mock.calls[0]?.[0].userMessage as string;
    expect(msg).toContain('Problem: design Y');
    expect(msg).toContain('Context: prior work notes');
  });
});
