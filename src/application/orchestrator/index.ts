import { invokeChancellor } from '../chancellor/agent.js';
import { invokeExecutor } from '../executor/agent.js';
import { invokeAide } from '../aide/agent.js';
import { stateStore } from '../../infra/state/council-state.js';
import { logger } from '../../infra/logging/logger.js';
import { CouncilError } from '../../domain/models/types.js';
import type { CouncilSession } from '../../domain/models/types.js';

// ─── Complexity heuristic ─────────────────────────────────────────────────────
// Deterministic, no LLM call — avoids spending tokens on a meta-decision.

type Complexity = 'trivial' | 'simple' | 'complex';

const COMPLEX_KEYWORDS = [
  'plan', 'design', 'architect', 'strategy', 'analyze', 'analyse',
  'assess', 'risk', 'system', 'build', 'create', 'implement', 'develop',
];

const TRIVIAL_KEYWORDS = ['format', 'convert', 'transform', 'clean', 'list', 'count'];

function assessComplexity(problem: string): Complexity {
  const lower = problem.toLowerCase();
  const wordCount = problem.split(/\s+/).length;

  if (wordCount > 60 || COMPLEX_KEYWORDS.some((kw) => lower.includes(kw))) {
    return 'complex';
  }

  if (wordCount < 15 && TRIVIAL_KEYWORDS.some((kw) => lower.includes(kw))) {
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

      const aideResult = await invokeAide(crypto.randomUUID(), { problem });
      stateStore.recordAideResult(request_id, aideResult);
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

      // Handle any Aide delegations from the Executor
      for (const task of execResult.delegated_tasks) {
        if (task.status === 'pending') {
          stateStore.recordAgentCall(request_id, 'aide');
          const aideResult = await invokeAide(task.task_id, { problem: task.description });
          stateStore.recordAideResult(request_id, aideResult);
        }
      }

      stateStore.complete(request_id, startedAt);

      return {
        request_id,
        complexity,
        result: buildResultSummary(stateStore.get(request_id)),
        session: stateStore.get(request_id),
      };
    }

    // ── Complex: Chancellor → Executor(s) → Aide (as needed) ─────────────────
    stateStore.setPhase(request_id, 'planning');
    stateStore.recordAgentCall(request_id, 'chancellor');

    const chancellorPlan = await invokeChancellor({ problem });
    session.chancellor_plan = chancellorPlan;

    logger.info(
      { request_id, steps: chancellorPlan.plan.length },
      'Chancellor plan received',
    );

    stateStore.setPhase(request_id, 'executing');

    for (const step of chancellorPlan.plan) {
      logger.info({ request_id, step_id: step.id }, 'Executing plan step');
      stateStore.recordAgentCall(request_id, 'executor');
      stateStore.get(request_id).executor_progress.current_step = step.id;

      const execResult = await invokeExecutor({
        problem: step.description,
        context: JSON.stringify({ plan: chancellorPlan, current_step: step }),
      });

      stateStore.recordExecutorResult(request_id, execResult);

      // Handle Aide delegations
      for (const task of execResult.delegated_tasks) {
        if (task.status === 'pending') {
          stateStore.recordAgentCall(request_id, 'aide');
          const aideResult = await invokeAide(task.task_id, {
            problem: task.description,
            context: `Part of step: ${step.description}`,
          });
          stateStore.recordAideResult(request_id, aideResult);
        }
      }

      if (execResult.status === 'blocked') {
        logger.warn({ request_id, step_id: step.id, blockers: execResult.blockers }, 'Step blocked');
        // Continue to next step rather than halting — partial completion is better than none
      }
    }

    stateStore.complete(request_id, startedAt);

    return {
      request_id,
      complexity,
      result: buildResultSummary(stateStore.get(request_id)),
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildResultSummary(session: CouncilSession): string {
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

  lines.push(`---`);
  lines.push(`Session: ${session.request_id} | Agents: ${session.metrics.agents_invoked.join(', ')} | Duration: ${session.metrics.duration_ms ?? 0}ms`);

  return lines.join('\n');
}
