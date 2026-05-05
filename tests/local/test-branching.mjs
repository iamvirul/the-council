/**
 * Test 2: Chancellor plan with 1 low-complexity step → routes directly to Aide
 * Verifies: no Executor call, Aide call happens, session shows correct agents_invoked.
 *
 * Run:  node tests/local/test-branching.mjs
 *
 * Strategy: We mock invokeChancellor to return a hardcoded single-step low plan,
 * then observe the orchestrator routes to Aide (not Executor).
 * We intercept at the agent level via a real-but-short call to the Aide.
 */

process.env['COUNCIL_PERSIST'] = 'memory';

// We'll use module mocking by shimming the module cache. Since this is ESM we
// monkey-patch the exported stateStore to spy on recordAgentCall.

import { stateStore } from '../../dist/infra/state/council-state.js';

// Track agent calls
const agentCallLog = [];
const originalRecordAgentCall = stateStore.recordAgentCall.bind(stateStore);
stateStore.recordAgentCall = (requestId, role) => {
  agentCallLog.push(role);
  return originalRecordAgentCall(requestId, role);
};

console.log('\n=== TEST: Conditional branching — single low step → Aide ===');
console.log('Strategy: mock invokeChancellor to return a 1-step low plan');
console.log('Expecting: chancellor + aide invoked, executor NOT invoked\n');

// Import and mock invokeChancellor to return a controlled plan
const chancellorModule = await import('../../dist/application/chancellor/agent.js');
const originalInvokeChancellor = chancellorModule.invokeChancellor;

// Mock Chancellor to return a single low-complexity step plan
chancellorModule.invokeChancellor = async (opts) => {
  console.log('Mock Chancellor invoked');
  return {
    analysis: 'Simple formatting task requiring a single low-complexity step',
    plan: [
      {
        id: 'step-1',
        description: 'Format the JSON blob according to specification',
        complexity: 'low',
        assignee: 'aide',
        dependencies: [],
        success_criteria: 'JSON is properly formatted',
      },
    ],
  };
};

// Mock Aide to prevent actual agent invocation
const aideModule = await import('../../dist/application/aide/agent.js');
const originalInvokeAide = aideModule.invokeAide;
aideModule.invokeAide = async (taskId, opts) => {
  console.log('Mock Aide invoked');
  return {
    task_id: taskId,
    result: 'Task completed successfully',
  };
};

// Mock Supervisor to prevent actual agent invocation
const supervisorModule = await import('../../dist/application/supervisor/agent.js');
const originalInvokeSupervisor = supervisorModule.invokeSupervisor;
supervisorModule.invokeSupervisor = async (params) => {
  console.log('Mock Supervisor invoked');
  return {
    subject: params.subject_id,
    subject_type: params.subject_type,
    approved: true,
    flags: [],
    recommendation: 'Approved',
  };
};

// Dynamically import orchestrator AFTER patching
const { orchestrate } = await import('../../dist/application/orchestrator/index.js');

// Call orchestrate with a problem that triggers the complex path
// (contains "plan" keyword to ensure complexity = 'complex')
try {
  console.log('Calling orchestrate with complex problem...');
  const result = await orchestrate('plan a simple JSON formatting task');

  console.log(`\nOrchestration completed: ${result.request_id}`);
  console.log(`Complexity assessed: ${result.complexity}`);
  console.log(`Agents invoked: ${agentCallLog.join(', ')}`);

  // Verify the branching worked correctly
  const hasChancellor = agentCallLog.includes('chancellor');
  const hasAide = agentCallLog.includes('aide');
  const hasExecutor = agentCallLog.includes('executor');

  console.log('\nAssertion checks:');
  console.log(`  Chancellor invoked? ${hasChancellor} (expected: true)`);
  console.log(`  Aide invoked? ${hasAide} (expected: true)`);
  console.log(`  Executor invoked? ${hasExecutor} (expected: false)`);

  if (hasChancellor && hasAide && !hasExecutor) {
    console.log('\nPASS ✅  — single low-complexity step correctly routed to Aide, bypassing Executor');
  } else {
    console.log('\nFAIL ❌  — incorrect routing detected');
    process.exit(1);
  }
} catch (err) {
  console.error('\nFAIL ❌  — orchestration threw error:', err.message);
  process.exit(1);
} finally {
  // Restore original functions
  chancellorModule.invokeChancellor = originalInvokeChancellor;
  aideModule.invokeAide = originalInvokeAide;
  supervisorModule.invokeSupervisor = originalInvokeSupervisor;
}
