import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { CouncilError } from '../../../src/domain/models/types.js';

vi.mock('../../../src/infra/agent-sdk/runner.js', () => ({
  runAgent: vi.fn(),
}));

import { runAgent } from '../../../src/infra/agent-sdk/runner.js';
import { invokeAide } from '../../../src/application/aide/agent.js';

const mockedRun = runAgent as unknown as Mock;

const VALID_RESPONSE = {
  task_id: 'task-1',
  status: 'completed',
  result: 'formatted output',
  approach: 'straight transform',
  quality_check: { meets_criteria: true, notes: '' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('invokeAide — parsing', () => {
  it('parses a valid raw JSON response', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    const r = await invokeAide('task-1', { problem: 'format this' });
    expect(r.task_id).toBe('task-1');
    expect(r.status).toBe('completed');
  });

  it('extracts JSON from inside a ```json fence', async () => {
    mockedRun.mockResolvedValueOnce('```json\n' + JSON.stringify(VALID_RESPONSE) + '\n```');
    const r = await invokeAide('task-1', { problem: 'format this' });
    expect(r.result).toBe('formatted output');
  });

  it('throws INVALID_JSON_RESPONSE on malformed JSON', async () => {
    mockedRun.mockResolvedValueOnce('{ broken');
    await expect(invokeAide('task-1', { problem: 'format this' })).rejects.toMatchObject({
      name: 'CouncilError',
      code: 'INVALID_JSON_RESPONSE',
      agent: 'aide',
    });
  });

  it('throws INVALID_JSON_RESPONSE when quality_check.meets_criteria is not boolean', async () => {
    mockedRun.mockResolvedValueOnce(
      JSON.stringify({
        ...VALID_RESPONSE,
        quality_check: { meets_criteria: 'true', notes: '' },
      }),
    );
    await expect(invokeAide('task-1', { problem: 'format this' })).rejects.toBeInstanceOf(
      CouncilError,
    );
  });
});

describe('invokeAide — user message composition', () => {
  it('sends Task ID + Task when no context is provided', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    await invokeAide('task-1', { problem: 'format this' });
    const msg = mockedRun.mock.calls[0]?.[0].userMessage as string;
    expect(msg).toBe('Task ID: task-1\nTask: format this');
  });

  it('appends context when provided', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    await invokeAide('task-1', { problem: 'format this', context: 'UTF-8 input' });
    const msg = mockedRun.mock.calls[0]?.[0].userMessage as string;
    expect(msg).toContain('Task ID: task-1');
    expect(msg).toContain('Task: format this');
    expect(msg).toContain('Context: UTF-8 input');
  });

  it('appends supervisor_feedback after context', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    await invokeAide('task-1', {
      problem: 'format this',
      context: 'UTF-8 input',
      supervisor_feedback: '--- SUPERVISOR FEEDBACK ---\nflag: foo\n--- END ---',
    });
    const msg = mockedRun.mock.calls[0]?.[0].userMessage as string;
    expect(msg.indexOf('Context: UTF-8 input')).toBeLessThan(msg.indexOf('SUPERVISOR FEEDBACK'));
  });

  it('allows supervisor_feedback without a context', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_RESPONSE));
    await invokeAide('task-1', {
      problem: 'format this',
      supervisor_feedback: '--- SUPERVISOR FEEDBACK ---\nflag: foo\n--- END ---',
    });
    const msg = mockedRun.mock.calls[0]?.[0].userMessage as string;
    expect(msg).not.toContain('Context:');
    expect(msg).toContain('SUPERVISOR FEEDBACK');
  });
});
