import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { CouncilError } from '../../../src/domain/models/types.js';

vi.mock('../../../src/infra/agent-sdk/runner.js', () => ({
  runAgent: vi.fn(),
}));

import { runAgent } from '../../../src/infra/agent-sdk/runner.js';
import { invokeExecutor } from '../../../src/application/executor/agent.js';

const mockedRun = runAgent as unknown as Mock;

const VALID_RESPONSE = {
  status: 'completed',
  step_id: 'step-1',
  what_was_done: 'implemented',
  result: 'code body',
  delegated_tasks: [],
  blockers: [],
  quality_assessment: 'meets criteria',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('invokeExecutor — parsing', () => {
  it('parses a valid raw JSON response', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    const r = await invokeExecutor({ problem: 'do X' });
    expect(r.step_id).toBe('step-1');
    expect(r.status).toBe('completed');
  });

  it('extracts JSON from inside a ```json fence', async () => {
    mockedRun.mockResolvedValueOnce('```json\n' + JSON.stringify(VALID_RESPONSE) + '\n```');
    const r = await invokeExecutor({ problem: 'do X' });
    expect(r.result).toBe('code body');
  });

  it('throws INVALID_JSON_RESPONSE on malformed JSON', async () => {
    mockedRun.mockResolvedValueOnce('{ not valid');
    await expect(invokeExecutor({ problem: 'do X' })).rejects.toMatchObject({
      name: 'CouncilError',
      code: 'INVALID_JSON_RESPONSE',
      agent: 'executor',
    });
  });

  it('throws INVALID_JSON_RESPONSE when status enum is out of range', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify({ ...VALID_RESPONSE, status: 'frobnicated' }));
    await expect(invokeExecutor({ problem: 'do X' })).rejects.toBeInstanceOf(CouncilError);
  });

  it('enforces the delegated_tasks cap (Zod rejects > 10 tasks)', async () => {
    const oversized = {
      ...VALID_RESPONSE,
      delegated_tasks: Array.from({ length: 11 }, (_, i) => ({
        task_id: `t-${i}`,
        description: 'desc',
        status: 'pending' as const,
      })),
    };
    mockedRun.mockResolvedValueOnce(JSON.stringify(oversized));
    await expect(invokeExecutor({ problem: 'do X' })).rejects.toMatchObject({
      code: 'INVALID_JSON_RESPONSE',
    });
  });
});

describe('invokeExecutor — user message composition', () => {
  it('sends task-only message when no context is provided', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    await invokeExecutor({ problem: 'do X' });
    const msg = mockedRun.mock.calls[0]?.[0].userMessage as string;
    expect(msg).toBe('Task: do X');
  });

  it("embeds plan context under the Chancellor's plan heading", async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    await invokeExecutor({ problem: 'do X', context: 'plan JSON' });
    const msg = mockedRun.mock.calls[0]?.[0].userMessage as string;
    expect(msg).toContain('Task: do X');
    expect(msg).toContain("Context (Chancellor's plan):");
    expect(msg).toContain('plan JSON');
  });

  it('appends supervisor_feedback at the tail of the prompt', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    await invokeExecutor({
      problem: 'do X',
      context: 'plan JSON',
      supervisor_feedback: '--- SUPERVISOR FEEDBACK ---\nflag: foo\n--- END ---',
    });
    const msg = mockedRun.mock.calls[0]?.[0].userMessage as string;
    expect(msg.indexOf('Task: do X')).toBeLessThan(msg.indexOf('plan JSON'));
    expect(msg.indexOf('plan JSON')).toBeLessThan(msg.indexOf('SUPERVISOR FEEDBACK'));
  });

  it('propagates max_turns when provided', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    await invokeExecutor({ problem: 'do X', max_turns: 4 });
    expect(mockedRun.mock.calls[0]?.[0].maxTurns).toBe(4);
  });
});
