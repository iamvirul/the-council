import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { z } from 'zod';

vi.mock('../../../src/infra/agent-sdk/runner.js', () => ({
  runAgent: vi.fn(),
}));

import { runAgent } from '../../../src/infra/agent-sdk/runner.js';
import { runAgentWithValidation } from '../../../src/infra/agent-sdk/run-with-validation.js';

const mockedRunAgent = runAgent as unknown as Mock;

const TestSchema = z.object({
  id: z.string(),
  status: z.enum(['ok', 'err']),
});

const VALID = { id: 't', status: 'ok' as const };
const VALID_JSON = JSON.stringify(VALID);

const runParams = {
  role: 'aide' as const,
  model: 'm',
  systemPrompt: 'p',
  userMessage: 'u',
  maxTurns: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runAgentWithValidation', () => {
  it('returns parsed value on first attempt when the response is valid', async () => {
    mockedRunAgent.mockResolvedValueOnce(VALID_JSON);

    const out = await runAgentWithValidation(runParams, TestSchema);
    expect(out).toEqual(VALID);
    expect(mockedRunAgent).toHaveBeenCalledTimes(1);
  });

  it('retries once on unparseable JSON and returns the second response', async () => {
    mockedRunAgent
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce(VALID_JSON);

    const out = await runAgentWithValidation(runParams, TestSchema);
    expect(out).toEqual(VALID);
    expect(mockedRunAgent).toHaveBeenCalledTimes(2);
  });

  it('retries once on schema violation and returns the second response', async () => {
    mockedRunAgent
      .mockResolvedValueOnce(JSON.stringify({ id: 't', status: 'wrong-enum' }))
      .mockResolvedValueOnce(VALID_JSON);

    const out = await runAgentWithValidation(runParams, TestSchema);
    expect(out).toEqual(VALID);
    expect(mockedRunAgent).toHaveBeenCalledTimes(2);
  });

  it('retries once on prose-wrapped JSON that slips past parseAgentJson', async () => {
    // parseAgentJson recovers most prose, but if the model returns raw prose
    // with no JSON at all, we need the retry path.
    mockedRunAgent
      .mockResolvedValueOnce('I could not complete this task.')
      .mockResolvedValueOnce(VALID_JSON);

    const out = await runAgentWithValidation(runParams, TestSchema);
    expect(out).toEqual(VALID);
    expect(mockedRunAgent).toHaveBeenCalledTimes(2);
  });

  it('throws the last error when both attempts fail', async () => {
    mockedRunAgent
      .mockResolvedValueOnce('garbage 1')
      .mockResolvedValueOnce('garbage 2');

    await expect(runAgentWithValidation(runParams, TestSchema)).rejects.toThrow();
    expect(mockedRunAgent).toHaveBeenCalledTimes(2);
  });

  it('does not retry when runAgent itself throws (CLI-level failure propagates)', async () => {
    const cliError = new Error('claude CLI crashed');
    mockedRunAgent.mockRejectedValueOnce(cliError);

    await expect(runAgentWithValidation(runParams, TestSchema)).rejects.toBe(cliError);
    // Only 1 invocation — runAgent errors are for the caller to handle
    // (they signal a transport problem, not a model-output problem).
    expect(mockedRunAgent).toHaveBeenCalledTimes(1);
  });

  it('passes identical RunAgentParams to every attempt', async () => {
    mockedRunAgent
      .mockResolvedValueOnce('bad')
      .mockResolvedValueOnce(VALID_JSON);

    await runAgentWithValidation(runParams, TestSchema);
    expect(mockedRunAgent.mock.calls[0]?.[0]).toEqual(runParams);
    expect(mockedRunAgent.mock.calls[1]?.[0]).toEqual(runParams);
  });
});
