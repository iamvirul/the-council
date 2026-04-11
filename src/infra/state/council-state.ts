// In-memory session store. Sessions live for the lifetime of the MCP server process.
import type { CouncilSession, AgentRole, ExecutorResponse, AideResponse, SessionPhase, ChancellorResponse } from '../../domain/models/types.js';
import { CouncilError } from '../../domain/models/types.js';

// Cap at 500 sessions — evict oldest when exceeded to prevent OOM.
const MAX_SESSIONS = 500;

class CouncilStateStore {
  private sessions = new Map<string, CouncilSession>();

  create(problem: string): CouncilSession {
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.values()].sort(
        (a, b) => a.created_at.localeCompare(b.created_at),
      )[0];
      if (oldest) this.sessions.delete(oldest.request_id);
    }

    const session: CouncilSession = {
      request_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      problem,
      phase: 'planning',
      executor_progress: {
        completed_steps: [],
        results: [],
      },
      aide_results: [],
      metrics: {
        total_agent_calls: 0,
        agents_invoked: [],
      },
    };
    this.sessions.set(session.request_id, session);
    return session;
  }

  get(requestId: string): CouncilSession {
    const session = this.sessions.get(requestId);
    if (!session) {
      throw new CouncilError(
        `Session not found: ${requestId}`,
        'SESSION_NOT_FOUND',
      );
    }
    return session;
  }

  getOptional(requestId: string): CouncilSession | undefined {
    return this.sessions.get(requestId);
  }

  setPhase(requestId: string, phase: SessionPhase): void {
    const session = this.get(requestId);
    session.phase = phase;
  }

  setChancellorPlan(requestId: string, plan: ChancellorResponse): void {
    const session = this.get(requestId);
    session.chancellor_plan = plan;
  }

  setCurrentStep(requestId: string, stepId: string): void {
    const session = this.get(requestId);
    session.executor_progress.current_step = stepId;
  }

  recordAgentCall(requestId: string, role: AgentRole): void {
    const session = this.get(requestId);
    session.metrics.total_agent_calls++;
    if (!session.metrics.agents_invoked.includes(role)) {
      session.metrics.agents_invoked.push(role);
    }
  }

  recordExecutorResult(requestId: string, result: ExecutorResponse): void {
    const session = this.get(requestId);
    session.executor_progress.results.push(result);
    session.executor_progress.completed_steps.push(result.step_id);
    session.executor_progress.current_step = result.next_step;
  }

  recordAideResult(requestId: string, result: AideResponse): void {
    const session = this.get(requestId);
    session.aide_results.push(result);
  }

  complete(requestId: string, startedAt: number): void {
    const session = this.get(requestId);
    session.phase = 'complete';
    session.metrics.duration_ms = Date.now() - startedAt;
  }

  fail(requestId: string, startedAt: number): void {
    const session = this.get(requestId);
    session.phase = 'failed';
    session.metrics.duration_ms = Date.now() - startedAt;
  }

  list(): CouncilSession[] {
    return Array.from(this.sessions.values());
  }

  delete(requestId: string): void {
    this.sessions.delete(requestId);
  }
}

// Singleton — one store per process lifetime.
export const stateStore = new CouncilStateStore();
