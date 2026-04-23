import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../../../src/infra/state/stores/memory-store.js';

describe('MemoryStore — eval_retries metric', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('initializes eval_retries to 0 on create()', () => {
    const s = store.create('problem');
    expect(s.metrics.eval_retries).toBe(0);
  });

  it('increments eval_retries by 1 per recordEvalRetry()', () => {
    const s = store.create('problem');
    store.recordEvalRetry(s.request_id);
    store.recordEvalRetry(s.request_id);
    store.recordEvalRetry(s.request_id);

    expect(store.get(s.request_id).metrics.eval_retries).toBe(3);
  });

  it('keeps eval_retries independent across sessions', () => {
    const a = store.create('A');
    const b = store.create('B');

    store.recordEvalRetry(a.request_id);
    store.recordEvalRetry(a.request_id);
    store.recordEvalRetry(b.request_id);

    expect(store.get(a.request_id).metrics.eval_retries).toBe(2);
    expect(store.get(b.request_id).metrics.eval_retries).toBe(1);
  });
});
