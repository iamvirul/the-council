import { invokeChancellor, invokeChancellorCoherence } from '../chancellor/agent.js';
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
  PlanStep,
} from '../../domain/models/types.js';
import { CAVEMAN_MODE } from '../../infra/config/caveman.js';
import { EVAL_RETRIES } from '../../infra/config/eval.js';
import { AGENT_TIMEOUT_MS } from '../../infra/config/timeout.js';
import { MIN_SCORE } from '../../infra/config/min-score.js';
import { withAgentRetry } from '../../infra/agent-sdk/retry.js';
import { buildSupervisorFeedback } from './feedback.js';
import { computeQualitySummary } from './quality.js';
export { computeQualitySummary } from './quality.js';

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
    {
      request_id,
      complexity,
      cavemanMode: CAVEMAN_MODE,
      evalRetries: EVAL_RETRIES,
      timeoutMs: AGENT_TIMEOUT_MS,
      minScore: MIN_SCORE,
    },
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

    logger.info({ request_id, steps: chancellorPlan.plan.length }, 'Chancellor plan received');

    stateStore.setPhase(request_id, 'executing');

    // ── Conditional branching: single low-complexity step → Aide directly ────
    // Avoids spinning up the Executor for work the Aide can handle alone.
    if (chancellorPlan.plan.length === 1 && chancellorPlan.plan[0].complexity === 'low') {
      const step = chancellorPlan.plan[0];
      logger.info(
        { request_id, step_id: step.id },
        'Single low-complexity step — routing directly to Aide',
      );
      stateStore.setCurrentStep(request_id, step.id);
      await runAideWithEval(request_id, problem, step.description, step.id, {
        problem: step.description,
        context: `Chancellor analysis: ${chancellorPlan.analysis}`,
      });
    } else {
      await executeSteps(request_id, problem, chancellorPlan.plan, chancellorPlan);

      // ── Loop 2: Executor → Chancellor coherence check ─────────────────────
      // After all steps finish, ask the Chancellor to assess whether the
      // execution matched the plan. Non-blocking — a failure here must not
      // abort the pipeline or change the final phase.
      await runCoherenceCheck(request_id, problem, chancellorPlan);
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

// ─── Step execution engine ────────────────────────────────────────────────────
// Runs a list of plan steps with:
//   - Step-level failure isolation: infrastructure errors are caught per-step,
//     recorded, and execution continues with remaining steps.
//   - Dynamic re-routing: if a step is blocked and no escalation has happened
//     yet, the Chancellor is re-invoked with the current state as context and
//     execution continues with the revised plan. Bounded to one escalation per
//     orchestration to prevent loops.
//   - Aide delegations handled after each step.

async function executeSteps(
  requestId: string,
  problem: string,
  steps: PlanStep[],
  chancellorPlan: Awaited<ReturnType<typeof invokeChancellor>>,
  hasEscalated = false,
  // ── Loop 3: Aide → Executor ───────────────────────────────────────────────
  // Aide results from the PREVIOUS step are forwarded as context so each
  // Executor step knows what the Aide actually delivered, rather than
  // assuming success. Accumulated across iterations and passed into
  // invokeExecutor via opts.aide_summary.
  previousAideSummary?: string,
): Promise<void> {
  for (const step of steps) {
    logger.info({ request_id: requestId, step_id: step.id }, 'Executing plan step');
    stateStore.setCurrentStep(requestId, step.id);

    let execResult: ExecutorResponse;

    try {
      execResult = await runExecutorWithEval(requestId, problem, step.description, {
        problem: step.description,
        context: JSON.stringify({ plan: chancellorPlan, current_step: step }),
        aide_summary: previousAideSummary,
      });
    } catch (err) {
      // ── Step-level failure isolation ──────────────────────────────────────
      // Infrastructure or timeout failures are recorded and skipped — partial
      // completion is better than aborting the entire pipeline.
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { request_id: requestId, step_id: step.id, err },
        'Step failed — recording failure and continuing with remaining steps',
      );
      stateStore.recordStepFailure(requestId, step.id, errorMsg);
      continue;
    }

    // ── Aide delegations ──────────────────────────────────────────────────
    // Each delegation is isolated: a failing Aide task is recorded as a step
    // failure and skipped rather than aborting the rest of the pipeline.
    // Results are collected so they can be forwarded to the next Executor step.
    const aideResultsThisStep: AideResponse[] = [];
    for (const task of execResult.delegated_tasks) {
      if (task.status === 'pending') {
        try {
          const aideResult = await runAideWithEval(requestId, problem, task.description, task.task_id, {
            problem: task.description,
            context: `Part of step: ${step.description}`,
          });
          aideResultsThisStep.push(aideResult);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error(
            { request_id: requestId, step_id: step.id, task_id: task.task_id, err },
            'Delegated Aide task failed — recording failure and continuing',
          );
          stateStore.recordStepFailure(requestId, task.task_id, errorMsg);
        }
      }
    }

    // Build the Aide summary that the NEXT step's Executor will receive.
    // Reset on every step — older summaries must not leak into steps that
    // had no Aide delegation.
    if (aideResultsThisStep.length > 0) {
      previousAideSummary = buildAideSummary(step.id, aideResultsThisStep);
      logger.debug(
        { request_id: requestId, step_id: step.id, aide_tasks: aideResultsThisStep.length },
        'Aide results will be forwarded to next Executor step',
      );
    } else {
      previousAideSummary = undefined;
    }

    // ── Dynamic re-routing on blocked step ────────────────────────────────
    // If blocked and we haven't already escalated, ask Chancellor to revise
    // the remaining plan. Limited to one escalation per orchestration.
    if (execResult.status === 'blocked') {
      if (!hasEscalated) {
        logger.info(
          { request_id: requestId, step_id: step.id, blockers: execResult.blockers },
          'Step blocked — escalating to Chancellor for plan revision',
        );

        try {
          const completedSteps = stateStore.get(requestId).executor_progress.completed_steps;
          stateStore.recordAgentCall(requestId, 'chancellor');

          const revisedPlan = await invokeChancellor({
            problem,
            context: JSON.stringify({
              original_analysis: chancellorPlan.analysis,
              original_plan: chancellorPlan.plan.map(s => s.description),
              completed_steps: completedSteps,
              blocked_at: step.id,
              blockers: execResult.blockers,
              instruction: 'Revise the plan for the remaining incomplete work only. Do not re-plan completed steps.',
            }),
          });

          stateStore.setChancellorPlan(requestId, revisedPlan);
          logger.info(
            { request_id: requestId, revised_steps: revisedPlan.plan.length },
            'Chancellor revised plan received — continuing with revised steps',
          );

          // Skip steps already completed, then run the rest.
          const completedSet = new Set(completedSteps);
          const remainingSteps = revisedPlan.plan.filter(s => !completedSet.has(s.id));
          await executeSteps(requestId, problem, remainingSteps, revisedPlan, true, previousAideSummary);
          return; // revised plan took over — stop the original loop
        } catch (err) {
          logger.warn(
            { request_id: requestId, step_id: step.id, err },
            'Chancellor revision failed — continuing with original plan',
          );
        }
      } else {
        logger.warn(
          { request_id: requestId, step_id: step.id, blockers: execResult.blockers },
          'Step blocked (already escalated once) — continuing with remaining steps',
        );
      }
    }
  }
}

// ─── Loop 2: Coherence check ──────────────────────────────────────────────────
// Non-blocking post-execution review. A failure here never aborts the pipeline.

async function runCoherenceCheck(
  requestId: string,
  problem: string,
  chancellorPlan: Awaited<ReturnType<typeof invokeChancellor>>,
): Promise<void> {
  const session = stateStore.get(requestId);
  const executionResults = session.executor_progress.results;
  const aideResults = session.aide_results;
  const stepFailures = session.executor_progress.step_failures ?? [];

  // Skip only when there is truly nothing to review — failed/skipped steps
  // are still meaningful signal for the Chancellor's coherence assessment.
  if (executionResults.length === 0 && aideResults.length === 0 && stepFailures.length === 0) return;

  const planSummary = chancellorPlan.plan
    .map(s => `- [${s.id}] ${s.description} (${s.complexity})`)
    .join('\n');

  const executionSummary = [
    executionResults.length > 0
      ? `Executor results:\n${executionResults.map(r => `- [${r.step_id}] status=${r.status}: ${r.result.slice(0, 300)}`).join('\n')}`
      : 'No Executor results.',
    aideResults.length > 0
      ? `Aide results:\n${aideResults.map(r => `- [${r.task_id}] status=${r.status}: ${r.result.slice(0, 200)}`).join('\n')}`
      : '',
    stepFailures.length > 0
      ? `Failed/skipped steps:\n${stepFailures.map(f => `- [${f.step_id}]: ${f.error.slice(0, 150)}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');

  try {
    stateStore.recordAgentCall(requestId, 'chancellor');
    const coherenceCheck = await invokeChancellorCoherence({
      problem,
      plan: planSummary,
      execution_summary: executionSummary,
    });
    stateStore.recordCoherenceCheck(requestId, coherenceCheck);
    logger.info(
      { request_id: requestId, coherent: coherenceCheck.coherent, gaps: coherenceCheck.gaps.length },
      'Coherence check completed',
    );
  } catch (err) {
    logger.warn(
      { request_id: requestId, err },
      'Coherence check failed — continuing without it',
    );
  }
}

// ─── Loop 3: Aide summary builder ────────────────────────────────────────────
// Formats Aide results into a compact prompt fragment for the next Executor step.

function buildAideSummary(stepId: string, aideResults: AideResponse[]): string {
  const lines = [
    `--- AIDE RESULTS FROM PREVIOUS STEP (${stepId}) ---`,
    `The following tasks were completed by the Aide. Incorporate these results into your work.`,
  ];
  for (const r of aideResults) {
    lines.push(`Task ${r.task_id} (${r.status}): ${r.result.slice(0, 500)}`);
  }
  lines.push(`--- END AIDE RESULTS ---`);
  return lines.join('\n');
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
    // recordAgentCall is inside the withAgentRetry lambda so every actual
    // subprocess invocation is counted — including infrastructure retries.
    const result = await withAgentRetry(
      () => {
        stateStore.recordAgentCall(requestId, 'executor');
        return invokeExecutor({ ...opts, supervisor_feedback: feedback });
      },
      { role: 'executor', step: opts.problem.slice(0, 80) },
    );
    lastResult = result;

    const verdict = await supervise(requestId, {
      subject_id: result.step_id,
      subject_type: 'executor_step',
      original_problem: problem,
      intent: stepDescription,
      output: result.result,
    });
    lastVerdict = verdict;

    // No verdict (supervisor errored) → accept (non-blocking behaviour preserved).
    // Approved AND score above threshold → accept.
    const scoreBelowGate = verdict !== undefined && MIN_SCORE > 0 && verdict.score !== undefined && verdict.score < MIN_SCORE;
    if (!verdict || (verdict.approved && !scoreBelowGate)) break;

    // Rejected or score-gated, retries exhausted → stop.
    if (attempt === maxRetries) {
      retriesExhausted = true;
      logger.warn(
        {
          request_id: requestId,
          step_id: result.step_id,
          attempts: attempt + 1,
          score: verdict.score,
          min_score: MIN_SCORE,
          flags: verdict.flags,
          recommendation: verdict.recommendation,
        },
        'Executor step still flagged after retry budget exhausted — surfacing anyway',
      );
      break;
    }

    // Rejected or score-gated, retries remain → loop with feedback.
    stateStore.recordEvalRetry(requestId);
    feedback = buildSupervisorFeedback(verdict);
    logger.info(
      {
        request_id: requestId,
        step_id: result.step_id,
        attempt: attempt + 1,
        next_attempt: attempt + 2,
        score: verdict.score,
        min_score: MIN_SCORE,
        flags: verdict.flags,
        reason: !verdict.approved ? 'rejected' : 'score_below_gate',
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
    // recordAgentCall is inside the withAgentRetry lambda so every actual
    // subprocess invocation is counted — including infrastructure retries.
    const result = await withAgentRetry(
      () => {
        stateStore.recordAgentCall(requestId, 'aide');
        return invokeAide(taskId, { ...opts, supervisor_feedback: feedback });
      },
      { role: 'aide', step: taskDescription.slice(0, 80) },
    );
    lastResult = result;

    const verdict = await supervise(requestId, {
      subject_id: taskId,
      subject_type: 'aide_task',
      original_problem: problem,
      intent: taskDescription,
      output: result.result,
    });
    lastVerdict = verdict;

    // No verdict (supervisor errored) → accept (non-blocking behaviour preserved).
    // Approved AND score above threshold → accept.
    const scoreBelowGate = verdict !== undefined && MIN_SCORE > 0 && verdict.score !== undefined && verdict.score < MIN_SCORE;
    if (!verdict || (verdict.approved && !scoreBelowGate)) break;

    if (attempt === maxRetries) {
      retriesExhausted = true;
      logger.warn(
        {
          request_id: requestId,
          task_id: taskId,
          attempts: attempt + 1,
          score: verdict.score,
          min_score: MIN_SCORE,
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
        score: verdict.score,
        min_score: MIN_SCORE,
        flags: verdict.flags,
        reason: !verdict.approved ? 'rejected' : 'score_below_gate',
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

/** @internal Exported for unit tests. */
export function buildResultSummary(session: CouncilSession, startedAt: number): string {
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

  const failures = session.executor_progress.step_failures ?? [];
  if (failures.length > 0) {
    lines.push(`## Skipped Steps (Infrastructure Failures)`);
    for (const f of failures) {
      lines.push(`- **${f.step_id}**: ${f.error}`);
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

  if (session.coherence_check) {
    const cc = session.coherence_check;
    const verdict = cc.coherent ? '✓ Coherent' : '⚠ Gaps detected';
    lines.push(`## Chancellor Coherence Review (${verdict})`);
    lines.push(cc.assessment);
    if (cc.gaps.length > 0) {
      lines.push('');
      lines.push('**Gaps:**');
      for (const g of cc.gaps) lines.push(`- ${g}`);
    }
    if (cc.recommendations.length > 0) {
      lines.push('');
      lines.push('**Recommendations:**');
      for (const r of cc.recommendations) lines.push(`- ${r}`);
    }
    lines.push('');
  }

  const quality = computeQualitySummary(session.supervisor_verdicts);
  if (quality !== null) {
    lines.push(`## Quality Summary`);
    if (quality.avg_score >= 0) {
      lines.push(`Average score: **${quality.avg_score}/100** | Lowest: **${quality.min_score}/100** (${quality.min_score_subject}) | Flags raised: **${quality.total_flags}**`);
      if (MIN_SCORE > 0) {
        // Deduplicate by subject so a single output retried multiple times is
        // counted as one, not once per verdict attempt.
        const gatedSubjects = new Set(
          session.supervisor_verdicts
            .filter(v => v.score !== undefined && v.score < MIN_SCORE)
            .map(v => v.subject),
        );
        if (gatedSubjects.size > 0) {
          lines.push(`Score-gate threshold: ${MIN_SCORE} — ${gatedSubjects.size} output(s) triggered retries.`);
        } else {
          lines.push(`Score-gate threshold: ${MIN_SCORE} — all outputs passed.`);
        }
      }
    } else {
      // Verdicts recorded but no scores produced — surface flags only.
      lines.push(`Flags raised: **${quality.total_flags}** (score unavailable — Supervisor did not produce a numeric score)`);
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

