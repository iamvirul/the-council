// In-memory session store — sessions live for the lifetime of the MCP process.
// Default backend when COUNCIL_PERSIST is unset.
import type {
  CouncilSession,
  AgentRole,
  ExecutorResponse,
  AideResponse,
  SessionPhase,
  ChancellorResponse,
  SupervisorVerdict,
} from '../../../domain/models/types.js';
import { CouncilError } from '../../../domain/models/types.js';
import type { SessionStore } from '../session-store.js';

const MAX_SESSIONS = 500;

export class MemoryStore implements SessionStore {
  private sessions = new Map<string, CouncilSession>();

  create(problem: string): CouncilSession {
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldestKey = this.sessions.keys().next().value;
      if (oldestKey) this.sessions.delete(oldestKey);
    }

    const session: CouncilSession = {
      request_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      problem,
      phase: 'planning',
      executor_progress: { completed_steps: [], results: [] },
      aide_results: [],
      supervisor_verdicts: [],
      metrics: { total_agent_calls: 0, agents_invoked: [] },
    };
    this.sessions.set(session.request_id, session);
    return session;
  }

  get(requestId: string): CouncilSession {
    const session = this.sessions.get(requestId);
    if (!session) throw new CouncilError(`Session not found: ${requestId}`, 'SESSION_NOT_FOUND');
    this.sessions.delete(requestId);
    this.sessions.set(requestId, session);
    return session;
  }

  getOptional(requestId: string): CouncilSession | undefined {
    const session = this.sessions.get(requestId);
    if (session) {
      this.sessions.delete(requestId);
      this.sessions.set(requestId, session);
    }
    return session;
  }

  setPhase(requestId: string, phase: SessionPhase): void {
    this.get(requestId).phase = phase;
  }

  setChancellorPlan(requestId: string, plan: ChancellorResponse): void {
    this.get(requestId).chancellor_plan = plan;
  }

  setCurrentStep(requestId: string, stepId: string): void {
    this.get(requestId).executor_progress.current_step = stepId;
  }

  recordAgentCall(requestId: string, role: AgentRole): void {
    const s = this.get(requestId);
    s.metrics.total_agent_calls++;
    if (!s.metrics.agents_invoked.includes(role)) s.metrics.agents_invoked.push(role);
  }

  recordExecutorResult(requestId: string, result: ExecutorResponse): void {
    const s = this.get(requestId);
    s.executor_progress.results.push(result);
    s.executor_progress.completed_steps.push(result.step_id);
    s.executor_progress.current_step = result.next_step;
  }

  recordAideResult(requestId: string, result: AideResponse): void {
    this.get(requestId).aide_results.push(result);
  }

  recordSupervisorVerdict(requestId: string, verdict: SupervisorVerdict): void {
    this.get(requestId).supervisor_verdicts.push(verdict);
  }

  recordCavemanMode(requestId: string, mode: string): void {
    this.get(requestId).metrics.caveman_mode = mode;
  }

  complete(requestId: string, startedAt: number): void {
    const s = this.get(requestId);
    s.phase = 'complete';
    s.metrics.duration_ms = Date.now() - startedAt;
  }

  fail(requestId: string, startedAt: number): void {
    const s = this.get(requestId);
    s.phase = 'failed';
    s.metrics.duration_ms = Date.now() - startedAt;
  }

  list(): CouncilSession[] {
    return Array.from(this.sessions.values());
  }

  delete(requestId: string): void {
    this.sessions.delete(requestId);
  }
}