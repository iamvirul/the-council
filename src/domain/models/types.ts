// Domain types — no imports from outside domain/

export type AgentRole = 'chancellor' | 'executor' | 'aide' | 'supervisor';
export type SessionPhase = 'planning' | 'executing' | 'complete' | 'failed';

// ─── Agent response shapes ────────────────────────────────────────────────────

export interface PlanStep {
  id: string;
  description: string;
  assignee: AgentRole;
  dependencies: string[];
  complexity: 'low' | 'medium' | 'high';
  success_criteria: string;
}

export interface Risk {
  severity: 'low' | 'medium' | 'high';
  description: string;
  mitigation: string;
}

export interface ChancellorResponse {
  analysis: string;
  key_insights: string[];
  plan: PlanStep[];
  risks: Risk[];
  assumptions: string[];
  success_metrics: string[];
  delegation_strategy: string;
  recommendations: string[];
}

export interface DelegatedTask {
  task_id: string;
  description: string;
  status: 'pending' | 'completed';
}

export interface ExecutorResponse {
  status: 'completed' | 'delegated' | 'blocked' | 'in_progress';
  step_id: string;
  what_was_done: string;
  result: string;
  delegated_tasks: DelegatedTask[];
  blockers: string[];
  quality_assessment: string;
  next_step?: string;
}

export interface SupervisorVerdict {
  subject: string;
  subject_type: 'executor_step' | 'aide_task';
  approved: boolean;
  confidence: 'high' | 'medium' | 'low';
  flags: string[];
  recommendation: string;
}

export interface AideResponse {
  task_id: string;
  status: 'completed' | 'failed' | 'needs_clarification';
  result: string;
  approach: string;
  quality_check: {
    meets_criteria: boolean;
    notes: string;
  };
}

// ─── Session / State ──────────────────────────────────────────────────────────

export interface CouncilSession {
  request_id: string;
  created_at: string;
  problem: string;
  phase: SessionPhase;
  chancellor_plan?: ChancellorResponse;
  executor_progress: {
    completed_steps: string[];
    current_step?: string;
    results: ExecutorResponse[];
  };
  aide_results: AideResponse[];
  supervisor_verdicts: SupervisorVerdict[];
  metrics: {
    /**
     * Raw count of agent invocations, including Supervisor reviews and every
     * retry triggered by the evaluation loop. For "how many unique agents
     * participated in this session", see `agents_invoked` instead.
     */
    total_agent_calls: number;
    /** Distinct set of agent roles that ran during this session. */
    agents_invoked: AgentRole[];
    duration_ms?: number;
    /** Caveman compression mode active during this session ('off' when disabled). */
    caveman_mode?: string;
    /**
     * Total number of Supervisor-triggered re-runs across all agent steps
     * in this session. 0 means every agent output was approved on first pass.
     */
    eval_retries: number;
  };
}

// ─── Error types ──────────────────────────────────────────────────────────────

export type CouncilErrorCode =
  | 'AGENT_SDK_ERROR'
  | 'INVALID_JSON_RESPONSE'
  | 'SESSION_NOT_FOUND'
  | 'ORCHESTRATION_FAILED'
  | 'AGENT_PARSE_ERROR'
  | 'SUPERVISOR_ERROR'
  | 'SESSION_PARSE_ERROR';

export class CouncilError extends Error {
  constructor(
    message: string,
    public readonly code: CouncilErrorCode,
    public readonly agent?: AgentRole,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CouncilError';
  }
}

// ─── Agent invoke options ─────────────────────────────────────────────────────

export interface AgentInvokeOptions {
  problem: string;
  context?: string;
  max_turns?: number;
  skipCaveman?: boolean;
  /**
   * Optional Supervisor feedback from a previous rejected attempt.
   * Appended to the user message so the agent can address flagged issues
   * on the next attempt. Set by the orchestrator's evaluation loop —
   * direct callers should leave this unset.
   */
  supervisor_feedback?: string;
}