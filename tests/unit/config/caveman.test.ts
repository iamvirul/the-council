import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveCavemanMode, applyCaveman } from '../../../src/infra/config/caveman.js';

const ENV_KEY = 'COUNCIL_CAVEMAN';

describe('resolveCavemanMode', () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("defaults to 'off' when unset", () => {
    expect(resolveCavemanMode()).toBe('off');
  });

  it('accepts off / lite / full / ultra', () => {
    for (const mode of ['off', 'lite', 'full', 'ultra'] as const) {
      process.env[ENV_KEY] = mode;
      expect(resolveCavemanMode()).toBe(mode);
    }
  });

  it('is case-insensitive on the env value', () => {
    process.env[ENV_KEY] = 'FULL';
    expect(resolveCavemanMode()).toBe('full');
  });

  it("falls back to 'off' for unknown values", () => {
    process.env[ENV_KEY] = 'verbose';
    expect(resolveCavemanMode()).toBe('off');
  });
});

describe('applyCaveman', () => {
  const prompt = 'SYSTEM PROMPT BODY\n<output_schema>\n{...}\n</output_schema>';

  it("returns the prompt unchanged when mode is 'off'", () => {
    expect(applyCaveman(prompt, 'off')).toBe(prompt);
  });

  it('appends a suffix (not a prefix) for lite / full / ultra', () => {
    for (const mode of ['lite', 'full', 'ultra'] as const) {
      const out = applyCaveman(prompt, mode);
      expect(out.startsWith(prompt)).toBe(true);
      expect(out.length).toBeGreaterThan(prompt.length);
    }
  });

  it('places the suffix after the closing output_schema so the rule wins', () => {
    const out = applyCaveman(prompt, 'full');
    expect(out.indexOf('</output_schema>')).toBeLessThan(out.indexOf('COMPRESSION RULE'));
  });

  it('produces distinct suffixes per mode', () => {
    const lite = applyCaveman(prompt, 'lite');
    const full = applyCaveman(prompt, 'full');
    const ultra = applyCaveman(prompt, 'ultra');
    expect(lite).not.toBe(full);
    expect(full).not.toBe(ultra);
    expect(lite).not.toBe(ultra);
  });
});
