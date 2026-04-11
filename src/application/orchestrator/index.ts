import { invokeChancellor } from '../chancellor/agent.js';
import { invokeExecutor } from '../executor/agent.js';
import { invokeAide } from '../aide/agent.js';
import { invokeSupervisor } from '../supervisor/agent.js';
import { stateStore } from '../../infra/state/council-state.js';
import { logger } from '../../infra/logging/logger.js';
import { CouncilError } from '../../domain/models/types.js';
import type { CouncilSession } from '../../domain/models/types.js';

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

  logger.info({ request_id, complexity }, 'Orchestration started');

  try {
    if (complexity === 'trivial') {
      // ── Trivial: go straight to Aide ─────────────────────────────────────
      stateStore.setPhase(request_id, 'executing');
      stateStore.recordAgentCall(request_id, 'aide');

      const taskId = crypto.randomUUID();
      const aideResult = await invokeAide(taskId, { problem });
      stateStore.recordAideResult(request_id, aideResult);
      await superviseAideTask(request_id, problem, problem, taskId, aideResult.result);
      stateStore.complete(request_id, startedAt);

      return {
        request_id,
        complexity,
        result: aideResult.result,
        session: stateStore.get(request_id),
      };
    }

    if (complexity === 'simple') {
      // ── Simple: Executor only ─────────────────────────────────────────────
      stateStore.setPhase(request_id, 'executing');
      stateStore.recordAgentCall(request_id, 'executor');

      const execResult = await invokeExecutor({ problem });
      stateStore.recordExecutorResult(request_id, execResult);
      await superviseExecutorStep(request_id, problem, problem, execResult.step_id, execResult.result);

      // Handle any Aide delegations from the Executor
      for (const task of execResult.delegated_tasks) {
        if (task.status === 'pending') {
          stateStore.recordAgentCall(request_id, 'aide');
          const aideResult = await invokeAide(task.task_id, { problem: task.description });
          stateStore.recordAideResult(request_id, aideResult);
          await superviseAideTask(request_id, problem, task.description, task.task_id, aideResult.result);
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
    stateStore.setChancellorPlan(request_id, chancellorPlan); // go through store, not direct mutation

    logger.info(
      { request_id, steps: chancellorPlan.plan.length },
      'Chancellor plan received',
    );

    stateStore.setPhase(request_id, 'executing');

    for (const step of chancellorPlan.plan) {
      logger.info({ request_id, step_id: step.id }, 'Executing plan step');
      stateStore.recordAgentCall(request_id, 'executor');
      stateStore.setCurrentStep(request_id, step.id); // go through store, not direct mutation

      const execResult = await invokeExecutor({
        problem: step.description,
        context: JSON.stringify({ plan: chancellorPlan, current_step: step }),
      });

      stateStore.recordExecutorResult(request_id, execResult);
      await superviseExecutorStep(request_id, problem, step.description, execResult.step_id, execResult.result);

      // Handle Aide delegations
      for (const task of execResult.delegated_tasks) {
        if (task.status === 'pending') {
          stateStore.recordAgentCall(request_id, 'aide');
          const aideResult = await invokeAide(task.task_id, {
            problem: task.description,
            context: `Part of step: ${step.description}`,
          });
          stateStore.recordAideResult(request_id, aideResult);
          await superviseAideTask(request_id, problem, task.description, task.task_id, aideResult.result);
        }
      }

      if (execResult.status === 'blocked') {
        logger.warn({ request_id, step_id: step.id, blockers: execResult.blockers }, 'Step blocked');
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

// ─── Supervisor (non-blocking) ────────────────────────────────────────────────
// Supervisor failure must never propagate — it is advisory only.

async function superviseExecutorStep(
  requestId: string,
  problem: string,
  stepDescription: string,
  stepId: string,
  output: string,
): Promise<void> {
  try {
    stateStore.recordAgentCall(requestId, 'supervisor');
    const verdict = await invokeSupervisor({
      subject_id: stepId,
      subject_type: 'executor_step',
      original_problem: problem,
      intent: stepDescription,
      output,
    });
    stateStore.recordSupervisorVerdict(requestId, verdict);

    if (!verdict.approved) {
      logger.warn(
        { request_id: requestId, step_id: stepId, flags: verdict.flags, recommendation: verdict.recommendation },
        'Supervisor flagged executor step',
      );
    }
  } catch (err) {
    logger.warn({ request_id: requestId, step_id: stepId, err }, 'Supervisor failed — continuing without verdict');
  }
}

async function superviseAideTask(
  requestId: string,
  problem: string,
  taskDescription: string,
  taskId: string,
  output: string,
): Promise<void> {
  try {
    stateStore.recordAgentCall(requestId, 'supervisor');
    const verdict = await invokeSupervisor({
      subject_id: taskId,
      subject_type: 'aide_task',
      original_problem: problem,
      intent: taskDescription,
      output,
    });
    stateStore.recordSupervisorVerdict(requestId, verdict);

    if (!verdict.approved) {
      logger.warn(
        { request_id: requestId, task_id: taskId, flags: verdict.flags, recommendation: verdict.recommendation },
        'Supervisor flagged aide task',
      );
    }
  } catch (err) {
    logger.warn({ request_id: requestId, task_id: taskId, err }, 'Supervisor failed — continuing without verdict');
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
  lines.push(`---`);
  lines.push(`Session: ${session.request_id} | Agents: ${session.metrics.agents_invoked.join(', ')} | Duration: ${durationMs}ms`);

  return lines.join('\n');
}
