import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveEvalRetries } from '../../../src/infra/config/eval.js';

const ENV_KEY = 'COUNCIL_EVAL_RETRIES';
const DEFAULT = 2;
const MIN = 0;
const MAX = 5;

describe('resolveEvalRetries', () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('defaults when unset', () => {
    expect(resolveEvalRetries()).toBe(DEFAULT);
  });

  it('defaults when empty string', () => {
    process.env[ENV_KEY] = '';
    expect(resolveEvalRetries()).toBe(DEFAULT);
  });

  it('defaults when whitespace-only', () => {
    process.env[ENV_KEY] = '   ';
    expect(resolveEvalRetries()).toBe(DEFAULT);
  });

  it('returns valid integer in range', () => {
    process.env[ENV_KEY] = '3';
    expect(resolveEvalRetries()).toBe(3);
  });

  it('returns the minimum boundary', () => {
    process.env[ENV_KEY] = '0';
    expect(resolveEvalRetries()).toBe(MIN);
  });

  it('returns the maximum boundary', () => {
    process.env[ENV_KEY] = '5';
    expect(resolveEvalRetries()).toBe(MAX);
  });

  it('clamps negative values to minimum', () => {
    process.env[ENV_KEY] = '-3';
    expect(resolveEvalRetries()).toBe(MIN);
  });

  it('clamps values above ceiling to maximum', () => {
    process.env[ENV_KEY] = '100';
    expect(resolveEvalRetries()).toBe(MAX);
  });

  it('falls back to default on non-integer (float)', () => {
    process.env[ENV_KEY] = '2.9';
    expect(resolveEvalRetries()).toBe(DEFAULT);
  });

  it('falls back to default on NaN / non-numeric', () => {
    process.env[ENV_KEY] = 'two';
    expect(resolveEvalRetries()).toBe(DEFAULT);
  });

  it('falls back to default on Infinity', () => {
    process.env[ENV_KEY] = 'Infinity';
    expect(resolveEvalRetries()).toBe(DEFAULT);
  });
});
