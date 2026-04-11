// Zod runtime schemas mirroring domain types.
// Used to validate agent JSON responses at the boundary before any value
// propagates to downstream agents. A cast alone (as T) gives no protection.
import { z } from 'zod';

const PlanStepSchema = z.object({
  id: z.string().max(200),
  description: z.string().max(2_000),
  assignee: z.enum(['chancellor', 'executor', 'aide']),
  dependencies: z.array(z.string().max(200)).max(20),
  complexity: z.enum(['low', 'medium', 'high']),
  success_criteria: z.string().max(1_000),
});

const RiskSchema = z.object({
  severity: z.enum(['low', 'medium', 'high']),
  description: z.string().max(1_000),
  mitigation: z.string().max(1_000),
});

export const ChancellorResponseSchema = z.object({
  analysis: z.string().max(10_000),
  key_insights: z.array(z.string().max(500)).max(20),
  plan: z.array(PlanStepSchema).max(20),
  risks: z.array(RiskSchema).max(20),
  assumptions: z.array(z.string().max(500)).max(20),
  success_metrics: z.array(z.string().max(500)).max(20),
  delegation_strategy: z.string().max(2_000),
  recommendations: z.array(z.string().max(500)).max(20),
});

const DelegatedTaskSchema = z.object({
  task_id: z.string().max(200),
  // Cap description — this string becomes a prompt to the Aide agent.
  // Unbounded length here is a prompt injection amplification vector.
  description: z.string().max(2_000),
  status: z.enum(['pending', 'completed']),
});

export const ExecutorResponseSchema = z.object({
  status: z.enum(['completed', 'delegated', 'blocked', 'in_progress']),
  step_id: z.string().max(200),
  what_was_done: z.string().max(5_000),
  result: z.string().max(20_000),
  // Hard cap at 10 — prevents a hallucinating/injected Executor from
  // spawning an unbounded number of downstream Aide invocations.
  delegated_tasks: z.array(DelegatedTaskSchema).max(10),
  blockers: z.array(z.string().max(500)).max(10),
  quality_assessment: z.string().max(2_000),
  next_step: z.string().max(500).optional(),
});

export const SupervisorVerdictSchema = z.object({
  subject: z.string().max(200),
  subject_type: z.enum(['executor_step', 'aide_task']),
  approved: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  // Cap flags — prevents an injected Supervisor from flooding logs
  flags: z.array(z.string().max(500)).max(10),
  recommendation: z.string().max(2_000),
});

export const AideResponseSchema = z.object({
  task_id: z.string().max(200),
  status: z.enum(['completed', 'failed', 'needs_clarification']),
  result: z.string().max(10_000),
  approach: z.string().max(2_000),
  quality_check: z.object({
    meets_criteria: z.boolean(),
    notes: z.string().max(1_000),
  }),
});
