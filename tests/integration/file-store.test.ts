import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileStore } from '../../src/infra/state/stores/file-store.js';

// Each test uses a private temp directory so real ~/.council is never touched
// and tests can run in parallel without cross-contamination.

describe('FileStore — persistence', () => {
  let dir: string;
  let store: FileStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'council-filestore-'));
    store = new FileStore(dir);
  });

  afterEach(() => {
    store.close?.();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a JSON file per session on create()', () => {
    const s = store.create('problem');
    const files = readdirSync(dir);
    expect(files).toContain(`${s.request_id}.json`);
  });

  it('round-trips session state via a second FileStore instance on the same dir', () => {
    const s = store.create('problem');
    store.recordAgentCall(s.request_id, 'executor');
    store.recordCavemanMode(s.request_id, 'full');
    store.complete(s.request_id, Date.now() - 50);
    store.close?.();

    const reopened = new FileStore(dir);
    const loaded = reopened.get(s.request_id);
    expect(loaded.problem).toBe('problem');
    expect(loaded.phase).toBe('complete');
    expect(loaded.metrics.agents_invoked).toContain('executor');
    expect(loaded.metrics.caveman_mode).toBe('full');
    reopened.close?.();
  });

  it('persists supervisor verdicts and eval_retries', () => {
    const s = store.create('p');
    store.recordEvalRetry(s.request_id);
    store.recordEvalRetry(s.request_id);
    store.recordSupervisorVerdict(s.request_id, {
      subject: 'step-1',
      subject_type: 'executor_step',
      approved: false,
      confidence: 'low',
      flags: ['bad'],
      recommendation: 'fix',
    });
    store.close?.();

    const reopened = new FileStore(dir);
    const loaded = reopened.get(s.request_id);
    expect(loaded.metrics.eval_retries).toBe(2);
    expect(loaded.supervisor_verdicts).toHaveLength(1);
    expect(loaded.supervisor_verdicts[0]?.approved).toBe(false);
    reopened.close?.();
  });

  it('delete() removes both the cache entry and the on-disk file', () => {
    const s = store.create('p');
    store.delete(s.request_id);
    const files = readdirSync(dir);
    expect(files.some(f => f.startsWith(s.request_id))).toBe(false);
    expect(store.getOptional(s.request_id)).toBeUndefined();
  });
});

describe('FileStore — resilience', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'council-filestore-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('tolerates a corrupt session JSON file on load', () => {
    // Seed with one valid and one corrupt file BEFORE constructing the store.
    const goodPath = join(dir, 'good.json');
    writeFileSync(
      goodPath,
      JSON.stringify({
        request_id: '11111111-1111-1111-1111-111111111111',
        created_at: new Date().toISOString(),
        problem: 'valid',
        phase: 'complete',
        executor_progress: { completed_steps: [], results: [] },
        aide_results: [],
        supervisor_verdicts: [],
        metrics: { total_agent_calls: 0, agents_invoked: [], eval_retries: 0 },
      }),
      'utf8',
    );
    writeFileSync(join(dir, 'bad.json'), '{not valid json', 'utf8');

    const store = new FileStore(dir);
    try {
      expect(store.list()).toHaveLength(1);
      expect(store.getOptional('11111111-1111-1111-1111-111111111111')).toBeDefined();
    } finally {
      store.close?.();
    }
  });

  it('skips session files missing a request_id', () => {
    writeFileSync(
      join(dir, 'missing-id.json'),
      JSON.stringify({ phase: 'complete', problem: 'x' }),
      'utf8',
    );

    const store = new FileStore(dir);
    try {
      expect(store.list()).toHaveLength(0);
    } finally {
      store.close?.();
    }
  });

  it('expires sessions older than 7 days on construction', () => {
    const oldId = '22222222-2222-2222-2222-222222222222';
    const newId = '33333333-3333-3333-3333-333333333333';
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();

    const template = (id: string, created_at: string) => ({
      request_id: id,
      created_at,
      problem: 'x',
      phase: 'complete',
      executor_progress: { completed_steps: [], results: [] },
      aide_results: [],
      supervisor_verdicts: [],
      metrics: { total_agent_calls: 0, agents_invoked: [], eval_retries: 0 },
    });

    writeFileSync(join(dir, `${oldId}.json`), JSON.stringify(template(oldId, stale)), 'utf8');
    writeFileSync(join(dir, `${newId}.json`), JSON.stringify(template(newId, fresh)), 'utf8');

    const store = new FileStore(dir);
    try {
      expect(store.getOptional(oldId)).toBeUndefined();
      expect(store.getOptional(newId)).toBeDefined();
      // Stale file is removed from disk too.
      expect(readdirSync(dir)).not.toContain(`${oldId}.json`);
    } finally {
      store.close?.();
    }
  });
});
