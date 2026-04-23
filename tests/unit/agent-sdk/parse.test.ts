import { describe, it, expect } from 'vitest';
import { parseAgentJson } from '../../../src/infra/agent-sdk/parse.js';

describe('parseAgentJson — happy paths', () => {
  it('parses a bare JSON object', () => {
    expect(parseAgentJson('{"a":1,"b":"two"}')).toEqual({ a: 1, b: 'two' });
  });

  it('parses a JSON object inside a ```json fence', () => {
    const raw = 'Some preamble\n```json\n{"a":1}\n```\nTrailing text';
    expect(parseAgentJson(raw)).toEqual({ a: 1 });
  });

  it('parses a JSON object inside a bare ``` fence', () => {
    const raw = '```\n{"a":1}\n```';
    expect(parseAgentJson(raw)).toEqual({ a: 1 });
  });

  it('handles leading whitespace and newlines', () => {
    expect(parseAgentJson('\n\n  {"a":1}\n')).toEqual({ a: 1 });
  });
});

describe('parseAgentJson — recovery from prose wrappers', () => {
  it('extracts a JSON object surrounded by preamble and sign-off', () => {
    const raw = "Here's the output:\n\n{\"status\":\"completed\",\"result\":\"r\"}\n\nLet me know if you need anything else.";
    expect(parseAgentJson(raw)).toEqual({ status: 'completed', result: 'r' });
  });

  it('tolerates trailing prose after the JSON', () => {
    const raw = '{"a":1}\n\nHope this helps!';
    expect(parseAgentJson(raw)).toEqual({ a: 1 });
  });

  it('tolerates leading prose before the JSON', () => {
    const raw = 'Based on my analysis:\n\n{"analysis":"deep"}';
    expect(parseAgentJson(raw)).toEqual({ analysis: 'deep' });
  });

  it('respects JSON string literals containing { and }', () => {
    const raw = 'Here you go:\n{"result":"closing } brace inside","next":"{open"}\nDone.';
    expect(parseAgentJson(raw)).toEqual({
      result: 'closing } brace inside',
      next: '{open',
    });
  });

  it('respects escaped quotes inside string literals', () => {
    const raw = 'Output:\n{"quoted":"she said \\"hi\\""}\nEnd';
    expect(parseAgentJson(raw)).toEqual({ quoted: 'she said "hi"' });
  });

  it('handles nested objects correctly', () => {
    const raw = 'Here:\n{"outer":{"inner":{"deep":true}}}\nDone.';
    expect(parseAgentJson(raw)).toEqual({ outer: { inner: { deep: true } } });
  });

  it('prefers the fenced content when both a fence and prose exist', () => {
    const raw = 'Outside fence: {"wrong":true}\n```json\n{"right":true}\n```';
    expect(parseAgentJson(raw)).toEqual({ right: true });
  });

  it('falls back to balanced extraction when the fence content is invalid', () => {
    const raw = '```\nnot json in fence\n```\n{"valid":true}';
    expect(parseAgentJson(raw)).toEqual({ valid: true });
  });
});

describe('parseAgentJson — failure', () => {
  it('throws a SyntaxError when no strategy can parse', () => {
    expect(() => parseAgentJson('not json at all')).toThrow(SyntaxError);
  });

  it('throws on an unterminated object', () => {
    expect(() => parseAgentJson('{ "a": 1')).toThrow();
  });

  it('throws on empty input', () => {
    expect(() => parseAgentJson('')).toThrow();
  });

  it('throws on a stray closing brace without an opener', () => {
    expect(() => parseAgentJson('} some text')).toThrow();
  });
});
