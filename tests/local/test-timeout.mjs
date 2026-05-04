/**
 * Test 1: COUNCIL_AGENT_TIMEOUT_MS — agent subprocess times out →
 *         AGENT_TIMEOUT error surfaced; withAgentRetry fires and surfaces
 *         AGENT_TIMEOUT after retry budget exhausted.
 *
 * Run:  node tests/local/test-timeout.mjs
 *
 * Strategy: Point CLAUDE_PATH at a stub that sleeps 60s so the timeout
 * always fires. Call runAgent directly (avoids orchestration stack) so
 * we only wait one timeout window per assertion. withAgentRetry is tested
 * with maxAttempts:2 — two 10s waits + 1s backoff = ~21s total.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLOW_STUB = join(__dirname, 'stubs/slow-claude.sh');

// Must be set before any import that reads env at module load time.
process.env['CLAUDE_PATH'] = SLOW_STUB;
process.env['COUNCIL_AGENT_TIMEOUT_MS'] = '10000'; // minimum valid value (10s)
process.env['COUNCIL_PERSIST'] = 'memory';

const TIMEOUT_MS = Number(process.env['COUNCIL_AGENT_TIMEOUT_MS']);

console.log(`\n=== TEST: Timeout (${TIMEOUT_MS}ms) ===`);
console.log(`Stub binary: ${SLOW_STUB}`);

// --- Test 1a: runAgent alone throws AGENT_TIMEOUT ---
console.log('\n--- 1a: runAgent → AGENT_TIMEOUT ---');
console.log('Expecting: AGENT_TIMEOUT thrown after ~10s\n');

const { runAgent } = await import('../../dist/infra/agent-sdk/runner.js');

const t0 = Date.now();
try {
  await runAgent({
    role: 'chancellor',
    model: 'claude-opus-4-5',
    systemPrompt: 'test',
    userMessage: 'test prompt',
    maxTurns: 1,
    skipCaveman: true,
  });
  console.log('FAIL ❌  — expected AGENT_TIMEOUT but got a result');
  process.exit(1);
} catch (err) {
  const elapsed = Date.now() - t0;
  const code = err?.code ?? err?.message ?? String(err);
  console.log(`Caught after ${elapsed}ms`);
  console.log(`  code: ${code}`);
  console.log(`  message: ${err?.message?.slice(0, 120)}`);

  if (code === 'AGENT_TIMEOUT') {
    console.log('PASS ✅  — AGENT_TIMEOUT surfaced from runAgent');
  } else {
    console.log('FAIL ❌  — unexpected error type from runAgent');
    console.error(err);
    process.exit(1);
  }
}

// --- Test 1b: withAgentRetry retries on AGENT_TIMEOUT and re-surfaces it ---
console.log('\n--- 1b: withAgentRetry → retries → AGENT_TIMEOUT ---');
console.log('Expecting: 2 attempts (each ~10s), AGENT_TIMEOUT surfaced\n');

const { withAgentRetry } = await import('../../dist/infra/agent-sdk/retry.js');

let attemptCount = 0;
const t1 = Date.now();

try {
  await withAgentRetry(
    () => {
      attemptCount++;
      return runAgent({
        role: 'executor',
        model: 'claude-opus-4-5',
        systemPrompt: 'test',
        userMessage: 'test prompt',
        maxTurns: 1,
        skipCaveman: true,
      });
    },
    { role: 'executor' },
    { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 500 }, // 2 attempts, 0.5s backoff
  );
  console.log('FAIL ❌  — expected AGENT_TIMEOUT but got a result');
  process.exit(1);
} catch (err) {
  const elapsed = Date.now() - t1;
  const code = err?.code ?? err?.message ?? String(err);
  console.log(`Caught after ${elapsed}ms (${attemptCount} attempts)`);
  console.log(`  code: ${code}`);

  const retried = attemptCount === 2;
  const isTimeout = code === 'AGENT_TIMEOUT';

  if (isTimeout && retried) {
    console.log('PASS ✅  — AGENT_TIMEOUT surfaced, withAgentRetry fired (2 attempts)');
  } else if (!isTimeout) {
    console.log('FAIL ❌  — unexpected error type');
    console.error(err);
    process.exit(1);
  } else {
    console.log('FAIL ❌  — unexpected attempt count (expected 2)');
    process.exit(1);
  }
}

console.log('\n=== All timeout tests PASSED ===');
