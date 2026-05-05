/**
 * Test 4 + 5: Agent spawn failure mid-pipeline
 * — failing step recorded in step_failures, remaining steps continue
 * — get_council_state shows step_failures
 *
 * Run:  node tests/local/test-spawn-failure.mjs
 *
 * Strategy: Point CLAUDE_PATH at a non-existent binary so every spawn
 * fails with AGENT_SDK_ERROR. The stubs must be configured via env vars
 * BEFORE any dynamic import, because runner.js resolves CLAUDE_BIN at
 * module load time (module-level constant).
 *
 * Key design decision: use `await import()` (dynamic) for any module that
 * transitively imports runner.js. Static `import` statements are hoisted by
 * the ESM loader and run before ANY code in this file — including env var
 * assignments — so CLAUDE_PATH would be ignored.
 */

// ── 1. Env vars FIRST — before any import that reaches runner.js ──────────────
process.env['CLAUDE_PATH'] = '/nonexistent-claude-binary-for-test';
process.env['COUNCIL_PERSIST'] = 'memory';
process.env['COUNCIL_AGENT_TIMEOUT_MS'] = '60000'; // long — we want spawn failure, not timeout

// ── 2. State store is safe to import statically (no runner.js dependency) ─────
import { stateStore } from '../../dist/infra/state/council-state.js';

console.log('\n=== TEST: Spawn failure + step_failures isolation ===');
console.log('Expecting: AGENT_SDK_ERROR on executor call, step recorded in step_failures\n');

// ── 3. Dynamic import AFTER env vars — ensures runner.js picks up CLAUDE_PATH ─
// All modules below transitively import runner.js, so they must be dynamic.
const { runExecutorWithEval } = await import('../../dist/application/orchestrator/index.js');

// ── 4. Create session ──────────────────────────────────────────────────────────
const session = stateStore.create('test problem for spawn failure');
const { request_id } = session;
console.log(`Session: ${request_id}`);
console.log(`CLAUDE_PATH: ${process.env['CLAUDE_PATH']}\n`);

// ── 5. Verify runExecutorWithEval throws on spawn failure ─────────────────────
try {
  // maxRetries=0 keeps the supervisor eval loop to 1 attempt.
  // withAgentRetry still fires 3 infrastructure retries (all fail with AGENT_SDK_ERROR).
  await runExecutorWithEval(request_id, 'test problem', 'step 1: do something', {
    problem: 'step 1: do something',
  }, 0);

  console.log('FAIL ❌  — expected error but got result');
  process.exit(1);
} catch (err) {
  const code = err?.code ?? String(err);
  console.log(`runExecutorWithEval threw: ${code}`);
  console.log(`  message: ${err?.message?.slice(0, 120)}`);

  if (code !== 'AGENT_SDK_ERROR') {
    console.log('FAIL ❌  — expected AGENT_SDK_ERROR but got a different error');
    process.exit(1);
  }
  console.log('PASS ✅  — AGENT_SDK_ERROR propagated correctly (not swallowed as INVALID_JSON_RESPONSE)');
}

// ── 6. Simulate executeSteps per-step isolation ───────────────────────────────
console.log('\n--- Simulating executeSteps isolation ---');
const FAKE_STEPS = [
  { id: 'step-1', description: 'first step' },
  { id: 'step-2', description: 'second step' },
];

for (const step of FAKE_STEPS) {
  try {
    await runExecutorWithEval(request_id, 'test', step.description, {
      problem: step.description,
    }, 0);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(`  Step ${step.id} failed (${err?.code ?? 'unknown'}) — recording and continuing`);
    stateStore.recordStepFailure(request_id, step.id, errorMsg);
  }
}

// ── 7. Verify step_failures in session state ──────────────────────────────────
const finalSession = stateStore.get(request_id);
const failures = finalSession.executor_progress.step_failures ?? [];

console.log(`\nstep_failures count: ${failures.length}`);
for (const f of failures) {
  console.log(`  - ${f.step_id}: ${f.error.slice(0, 80)}...`);
}

if (failures.length === FAKE_STEPS.length) {
  console.log('\nPASS ✅  — all failed steps recorded, session survived');
} else {
  console.log('\nFAIL ❌  — step_failures count mismatch');
  process.exit(1);
}
