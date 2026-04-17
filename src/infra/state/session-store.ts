// SessionStore interface — all persistence backends implement this contract.
// Switch backends via the COUNCIL_PERSIST env var:
//   unset | "memory"  → in-process LRU Map (default, no setup needed)
//   "file"            → JSON files at ~/.council/sessions/<id>.json
//   "sqlite"          → SQLite at ~/.council/council.db
import type {
  CouncilSession,
  AgentRole,
  ExecutorResponse,
  AideResponse,
  SessionPhase,
  ChancellorResponse,
  SupervisorVerdict,
} from '../../domain/models/types.js';

export interface SessionStore {
  create(problem: string): CouncilSession;
  get(requestId: string): CouncilSession;
  getOptional(requestId: string): CouncilSession | undefined;
  setPhase(requestId: string, phase: SessionPhase): void;
  setChancellorPlan(requestId: string, plan: ChancellorResponse): void;
  setCurrentStep(requestId: string, stepId: string): void;
  recordAgentCall(requestId: string, role: AgentRole): void;
  recordExecutorResult(requestId: string, result: ExecutorResponse): void;
  recordAideResult(requestId: string, result: AideResponse): void;
  recordSupervisorVerdict(requestId: string, verdict: SupervisorVerdict): void;
  complete(requestId: string, startedAt: number): void;
  fail(requestId: string, startedAt: number): void;
  list(): CouncilSession[];
  delete(requestId: string): void;
}
