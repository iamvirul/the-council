// Agent-response JSON parser.
//
// Each internal agent is prompted to return ONLY valid JSON, but the
// claude CLI occasionally returns the JSON wrapped in surrounding prose
// ("Here's the response:\n{...}\nHope that helps!") or inside a markdown
// fence. A strict `JSON.parse(raw.trim())` fails on the first case; a
// bare fence-match fails on the second when no fence is present.
//
// `parseAgentJson` tries three extraction strategies in order, returning
// the first candidate that JSON.parse accepts. If all fail, it throws
// the last SyntaxError so the caller's outer catch preserves its error
// context (wrapped into a CouncilError by each agent invoker).

/**
 * Extracts the first complete balanced {...} object from a string,
 * respecting JSON string literals so that `"{"` or `"}"` inside a quoted
 * value do not confuse the brace accounting. Returns `null` when no
 * balanced object is found.
 */
function extractBalancedObject(raw: string): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return raw.slice(start, i + 1);
      }
      if (depth < 0) {
        // Stray closing brace before any opener — reset.
        depth = 0;
        start = -1;
      }
    }
  }
  return null;
}

/**
 * Parses an agent's raw text output as JSON. Tries, in order:
 *
 *   1. The contents of a ``` or ```json fence, if present
 *   2. The first balanced {...} object in the raw string (string-aware
 *      so braces inside JSON string values are not mis-counted)
 *   3. The trimmed raw string
 *
 * Returns the first candidate that JSON.parse accepts. Throws the last
 * SyntaxError when every strategy fails, preserving the callers' error
 * context.
 */
export function parseAgentJson(raw: string): unknown {
  const candidates: string[] = [];

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) candidates.push(fenced[1].trim());

  const balanced = extractBalancedObject(raw);
  if (balanced) candidates.push(balanced);

  const trimmed = raw.trim();
  if (!candidates.includes(trimmed)) candidates.push(trimmed);

  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new SyntaxError('Agent response contained no parseable JSON');
}
