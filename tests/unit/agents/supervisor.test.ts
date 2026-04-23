import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { CouncilError } from '../../../src/domain/models/types.js';

vi.mock('../../../src/infra/agent-sdk/runner.js', () => ({
  runAgent: vi.fn(),
}));

import { runAgent } from '../../../src/infra/agent-sdk/runner.js';
import { invokeSupervisor } from '../../../src/application/supervisor/agent.js';

const mockedRun = runAgent as unknown as Mock;

const VALID_VERDICT = {
  subject: 'step-1',
  subject_type: 'executor_step',
  approved: true,
  confidence: 'high',
  flags: [],
  recommendation: 'ok',
};

const ctx = {
  subject_id: 'step-1',
  subject_type: 'executor_step' as const,
  original_problem: 'do the thing',
  intent: 'step desc',
  output: 'result body',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('invokeSupervisor — parsing', () => {
  it('parses a valid raw JSON response', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_VERDICT));

    const v = await invokeSupervisor(ctx);
    expect(v.subject).toBe('step-1');
    expect(v.approved).toBe(true);
  });

  it('extracts JSON from inside a ```json fence', async () => {
    mockedRun.mockResolvedValueOnce(
      '```json\n' + JSON.stringify(VALID_VERDICT) + '\n```',
    );
    const v = await invokeSupervisor(ctx);
    expect(v.subject).toBe('step-1');
  });

  it('extracts JSON from a bare ``` fence', async () => {
    mockedRun.mockResolvedValueOnce('```\n' + JSON.stringify(VALID_VERDICT) + '\n```');
    const v = await invokeSupervisor(ctx);
    expect(v.approved).toBe(true);
  });

  it('throws SUPERVISOR_ERROR on invalid JSON', async () => {
    mockedRun.mockResolvedValueOnce('not json at all');
    await expect(invokeSupervisor(ctx)).rejects.toMatchObject({
      name: 'CouncilError',
      code: 'SUPERVISOR_ERROR',
      agent: 'supervisor',
    });
  });

  it('throws SUPERVISOR_ERROR on schema violation (missing required field)', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify({ ...VALID_VERDICT, approved: undefined }));
    await expect(invokeSupervisor(ctx)).rejects.toBeInstanceOf(CouncilError);
  });

  it('throws SUPERVISOR_ERROR when confidence is not one of the enum values', async () => {
    mockedRun.mockResolvedValueOnce(
      JSON.stringify({ ...VALID_VERDICT, confidence: 'very-high' }),
    );
    await expect(invokeSupervisor(ctx)).rejects.toMatchObject({ code: 'SUPERVISOR_ERROR' });
  });
});

describe('invokeSupervisor — runAgent wiring', () => {
  it('skips caveman compression (recommendation is user-facing prose)', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_VERDICT));
    await invokeSupervisor(ctx);
    expect(mockedRun).toHaveBeenCalledTimes(1);
    expect(mockedRun.mock.calls[0]?.[0]).toMatchObject({
      role: 'supervisor',
      skipCaveman: true,
    });
  });

  it('sends a userMessage containing problem, intent, subject id, and output', async () => {
    mockedRun.mockResolvedValueOnce(JSON.stringify(VALID_VERDICT));
    await invokeSupervisor(ctx);
    const msg = mockedRun.mock.calls[0]?.[0].userMessage as string;
    expect(msg).toContain('do the thing');
    expect(msg).toContain('step desc');
    expect(msg).toContain('step-1');
    expect(msg).toContain('result body');
    expect(msg).toContain('executor_step');
  });
});
