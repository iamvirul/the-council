import { invokeChancellor } from '../chancellor/agent.js';
import { invokeExecutor } from '../executor/agent.js';
import { invokeAide } from '../aide/agent.js';
import { invokeSupervisor } from '../supervisor/agent.js';
import { stateStore } from '../../infra/state/council-state.js';
import { logger } from '../../infra/logging/logger.js';
import { CouncilError } from '../../domain/models/types.js';
import type {
  CouncilSession,
  ExecutorResponse,
  AideResponse,
  SupervisorVerdict,
  AgentInvokeOptions,
} from '../../domain/models/types.js';
import { CAVEMAN_MODE } from '../../infra/config/caveman.js';
import { EVAL_RETRIES } from '../../infra/config/eval.js';
import { buildSupervisorFeedback } from './feedback.js';

// ─── Complexity heuristic ─────────────────────────────────────────────────────
// Deterministic, no LLM call — avoids spending tokens on a meta-decision.
// Word-boundary regex prevents 'create a list' from matching 'create'.

type Complexity = 'trivial' | 'simple' | 'complex';

// Deliberately excludes generic words like 'build', 'create', 'implement' —
// too common in simple requests and would over-trigger Chancellor analysis.
const COMPLEX_PATTERN = /\b(plan|design|architect|strategy|analyze|analyse|assess|risk)\b/i;
const TRIVIAL_PATTERN = /\b(format|convert|transform|clean|list|count)\b/i;

function assessComplexity(problem: string): Complexity {
  const wordCount = problem.split(/\s+/).length;

  if (wordCount > 60 || COMPLEX_PATTERN.test(problem)) {
    return 'complex';
  }

  if (wordCount < 15 && TRIVIAL_PATTERN.test(problem)) {
    return 'trivial';
  }

  return 'simple';
}

// ─── Full orchestration ───────────────────────────────────────────────────────

export interface OrchestrateResult {
  request_id: string;
  complexity: Complexity;
  result: string;
  session: CouncilSession;
}

export async function orchestrate(problem: string): Promise<OrchestrateResult> {
  const session = stateStore.create(problem);
  const { request_id } = session;
  const startedAt = Date.now();
  const complexity = assessComplexity(problem);

  // Record caveman mode in session metrics so it's visible in get_council_state.
  stateStore.recordCavemanMode(request_id, CAVEMAN_MODE);

  logger.info(
    { request_id, complexity, cavemanMode: CAVEMAN_MODE, evalRetries: EVAL_RETRIES },
    'Orchestration started',
  );

  try {
    if (complexity === 'trivial') {
      // ── Trivial: go straight to Aide ─────────────────────────────────────
      stateStore.setPhase(request_id, 'executing');
      const taskId = crypto.randomUUID();
      await runAideWithEval(request_id, problem, problem, taskId, { problem });
      stateStore.complete(request_id, startedAt);

      const sessionNow = stateStore.get(request_id);
      const finalAide = sessionNow.aide_results[sessionNow.aide_results.length - 1];
      return {
        request_id,
        complexity,
        result: finalAide?.result ?? '',
        session: sessionNow,
      };
    }

    if (complexity === 'simple') {
      // ── Simple: Executor only ─────────────────────────────────────────────
      stateStore.setPhase(request_id, 'executing');

      const execResult = await runExecutorWithEval(request_id, problem, problem, { problem });

      // Handle any Aide delegations from the final (approved or best-effort) Executor output.
      for (const task of execResult.delegated_tasks) {
        if (task.status === 'pending') {
          await runAideWithEval(request_id, problem, task.description, task.task_id, {
            problem: task.description,
          });
        }
      }

      stateStore.complete(request_id, startedAt);

      return {
        request_id,
        complexity,
        result: buildResultSummary(stateStore.get(request_id), startedAt),
        session: stateStore.get(request_id),
      };
    }

    // ── Complex: Chancellor → Executor(s) → Aide (as needed) ─────────────────
    stateStore.setPhase(request_id, 'planning');
    stateStore.recordAgentCall(request_id, 'chancellor');

    const chancellorPlan = await invokeChancellor({ problem });
    stateStore.setChancellorPlan(request_id, chancellorPlan);

    logger.info(
      { request_id, steps: chancellorPlan.plan.length },
      'Chancellor plan received',
    );

    stateStore.setPhase(request_id, 'executing');

    for (const step of chancellorPlan.plan) {
      logger.info({ request_id, step_id: step.id }, 'Executing plan step');
      stateStore.setCurrentStep(request_id, step.id);

      const execResult = await runExecutorWithEval(request_id, problem, step.description, {
        problem: step.description,
        context: JSON.stringify({ plan: chancellorPlan, current_step: step }),
      });

      // Handle Aide delegations from the final Executor output.
      for (const task of execResult.delegated_tasks) {
        if (task.status === 'pending') {
          await runAideWithEval(request_id, problem, task.description, task.task_id, {
            problem: task.description,
            context: `Part of step: ${step.description}`,
          });
        }
      }

      if (execResult.status === 'blocked') {
        logger.warn(
          { request_id, step_id: step.id, blockers: execResult.blockers },
          'Step blocked',
        );
        // Continue to next step — partial completion is better than halting
      }
    }

    stateStore.complete(request_id, startedAt);

    return {
      request_id,
      complexity,
      result: buildResultSummary(stateStore.get(request_id), startedAt),
      session: stateStore.get(request_id),
    };
  } catch (err) {
    stateStore.fail(request_id, startedAt);
    logger.error({ request_id, err }, 'Orchestration failed');

    if (err instanceof CouncilError) throw err;

    throw new CouncilError(
      `Orchestration failed: ${err instanceof Error ? err.message : String(err)}`,
      'ORCHESTRATION_FAILED',
      undefined,
      err,
    );
  }
}

// ─── Evaluation loop ──────────────────────────────────────────────────────────
// Supervisor rejections trigger a re-invocation with feedback appended.
// The loop is bounded by EVAL_RETRIES (default 2 → up to 3 total attempts).
// If still rejected after retries, the flagged result is recorded and a
// warning is logged — the flagged verdict surfaces via buildResultSummary,
// so the caller always sees what the Supervisor flagged.
//
// Only the *final* attempt is recorded to the session result store. Every
// Supervisor verdict is recorded — the retry count reconstructs the trail.
// Supervisor failures themselves do NOT count as rejections; they are
// treated as "approved with no verdict" to preserve the original
// non-blocking behaviour when the Supervisor itself errors.

/**
 * @internal Exported for unit tests. `maxRetries` defaults to EVAL_RETRIES;
 * tests pass it explicitly instead of juggling env vars.
 */
export async function runExecutorWithEval(
  requestId: string,
  problem: string,
  stepDescription: string,
  opts: AgentInvokeOptions,
  maxRetries: number = EVAL_RETRIES,
): Promise<ExecutorResponse> {
  let lastResult: ExecutorResponse | undefined;
  let lastVerdict: SupervisorVerdict | undefined;
  let feedback: string | undefined;
  let retriesExhausted = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    stateStore.recordAgentCall(requestId, 'executor');

    const result = await invokeExecutor({ ...opts, supervisor_feedback: feedback });
    lastResult = result;

    const verdict = await supervise(requestId, {
      subject_id: result.step_id,
      subject_type: 'executor_step',
      original_problem: problem,
      intent: stepDescription,
      output: result.result,
    });
    lastVerdict = verdict;

    // No verdict (supervisor errored) or approved → accept.
    if (!verdict || verdict.approved) break;

    // Rejected and retries exhausted → stop.
    if (attempt === maxRetries) {
      retriesExhausted = true;
      logger.warn(
        {
          request_id: requestId,
          step_id: result.step_id,
          attempts: attempt + 1,
          flags: verdict.flags,
          recommendation: verdict.recommendation,
        },
        'Executor step still flagged after retry budget exhausted — surfacing anyway',
      );
      break;
    }

    // Rejected and retries remain → loop with feedback.
    stateStore.recordEvalRetry(requestId);
    feedback = buildSupervisorFeedback(verdict);
    logger.info(
      {
        request_id: requestId,
        step_id: result.step_id,
        attempt: attempt + 1,
        next_attempt: attempt + 2,
        flags: verdict.flags,
      },
      'Executor step rejected by Supervisor — re-running with feedback',
    );
  }

  // lastResult is always defined here — the loop runs at least once (EVAL_RETRIES >= 0
  // means attempt 0 always executes), and invokeExecutor either returns a result or throws.
  if (!lastResult) {
    throw new CouncilError(
      'Executor evaluation loop produced no result',
      'ORCHESTRATION_FAILED',
      'executor',
    );
  }

  stateStore.recordExecutorResult(requestId, lastResult);
  if (lastVerdict && !lastVerdict.approved && !retriesExhausted) {
    logger.warn(
      {
        request_id: requestId,
        step_id: lastResult.step_id,
        flags: lastVerdict.flags,
        recommendation: lastVerdict.recommendation,
      },
      'Supervisor flagged final executor step output',
    );
  }
  return lastResult;
}

/**
 * @internal Exported for unit tests. `maxRetries` defaults to EVAL_RETRIES;
 * tests pass it explicitly instead of juggling env vars.
 */
export async function runAideWithEval(
  requestId: string,
  problem: string,
  taskDescription: string,
  taskId: string,
  opts: AgentInvokeOptions,
  maxRetries: number = EVAL_RETRIES,
): Promise<AideResponse> {
  let lastResult: AideResponse | undefined;
  let lastVerdict: SupervisorVerdict | undefined;
  let feedback: string | undefined;
  let retriesExhausted = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    stateStore.recordAgentCall(requestId, 'aide');

    const result = await invokeAide(taskId, { ...opts, supervisor_feedback: feedback });
    lastResult = result;

    const verdict = await supervise(requestId, {
      subject_id: taskId,
      subject_type: 'aide_task',
      original_problem: problem,
      intent: taskDescription,
      output: result.result,
    });
    lastVerdict = verdict;

    if (!verdict || verdict.approved) break;

    if (attempt === maxRetries) {
      retriesExhausted = true;
      logger.warn(
        {
          request_id: requestId,
          task_id: taskId,
          attempts: attempt + 1,
          flags: verdict.flags,
          recommendation: verdict.recommendation,
        },
        'Aide task still flagged after retry budget exhausted — surfacing anyway',
      );
      break;
    }

    stateStore.recordEvalRetry(requestId);
    feedback = buildSupervisorFeedback(verdict);
    logger.info(
      {
        request_id: requestId,
        task_id: taskId,
        attempt: attempt + 1,
        next_attempt: attempt + 2,
        flags: verdict.flags,
      },
      'Aide task rejected by Supervisor — re-running with feedback',
    );
  }

  if (!lastResult) {
    throw new CouncilError(
      'Aide evaluation loop produced no result',
      'ORCHESTRATION_FAILED',
      'aide',
    );
  }

  stateStore.recordAideResult(requestId, lastResult);
  if (lastVerdict && !lastVerdict.approved && !retriesExhausted) {
    logger.warn(
      {
        request_id: requestId,
        task_id: taskId,
        flags: lastVerdict.flags,
        recommendation: lastVerdict.recommendation,
      },
      'Supervisor flagged final aide task output',
    );
  }
  return lastResult;
}

// ─── Supervisor call ──────────────────────────────────────────────────────────
// Records the agent call + verdict. Returns undefined when the Supervisor
// itself errors — callers must treat "no verdict" as approved so the
// Supervisor's own failures never block the pipeline.

interface SuperviseParams {
  subject_id: string;
  subject_type: 'executor_step' | 'aide_task';
  original_problem: string;
  intent: string;
  output: string;
}

async function supervise(
  requestId: string,
  params: SuperviseParams,
): Promise<SupervisorVerdict | undefined> {
  try {
    stateStore.recordAgentCall(requestId, 'supervisor');
    const verdict = await invokeSupervisor(params);
    stateStore.recordSupervisorVerdict(requestId, verdict);
    return verdict;
  } catch (err) {
    logger.warn(
      { request_id: requestId, subject_id: params.subject_id, err },
      'Supervisor failed — continuing without verdict',
    );
    return undefined;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildResultSummary(session: CouncilSession, startedAt: number): string {
  const lines: string[] = [];

  if (session.chancellor_plan) {
    lines.push(`## Chancellor's Analysis`);
    lines.push(session.chancellor_plan.analysis);
    lines.push('');
  }

  if (session.executor_progress.results.length > 0) {
    lines.push(`## Execution Results`);
    for (const r of session.executor_progress.results) {
      lines.push(`### Step: ${r.step_id}`);
      lines.push(r.result);
      lines.push('');
    }
  }

  if (session.aide_results.length > 0) {
    lines.push(`## Aide Outputs`);
    for (const r of session.aide_results) {
      lines.push(`**Task ${r.task_id}:** ${r.result}`);
    }
    lines.push('');
  }

  const flagged = session.supervisor_verdicts.filter(v => !v.approved);
  if (flagged.length > 0) {
    lines.push(`## Supervisor Flags`);
    for (const v of flagged) {
      lines.push(`- **${v.subject}** (${v.subject_type}): ${v.recommendation}`);
      for (const f of v.flags) lines.push(`  - ${f}`);
    }
    lines.push('');
  }

  const durationMs = Date.now() - startedAt;
  const retries = session.metrics.eval_retries ?? 0;
  lines.push(`---`);
  lines.push(
    `Session: ${session.request_id} | Agents: ${session.metrics.agents_invoked.join(', ')} | Duration: ${durationMs}ms | Retries: ${retries}`,
  );

  return lines.join('\n');
}
