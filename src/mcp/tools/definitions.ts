// Zod schemas for all MCP tool inputs.
// Raw shape objects (not z.object()) — the MCP SDK wraps them internally.
import { z } from 'zod';

export const orchestrateSchema = {
  problem: z
    .string()
    .min(1)
    .max(10_000)
    .describe(
      'The problem or task for The Council to solve. Complex problems trigger Chancellor analysis; simple ones go straight to Executor or Aide.',
    ),
};

export const consultChancellorSchema = {
  problem: z
    .string()
    .min(1)
    .max(10_000)
    .describe('Problem requiring deep strategic analysis and planning.'),
  context: z
    .string()
    .max(20_000)
    .optional()
    .describe('Additional background context to inform the analysis.'),
};

export const executeWithExecutorSchema = {
  task: z
    .string()
    .min(1)
    .max(10_000)
    .describe('The implementation task for the Executor to carry out.'),
  plan_context: z
    .string()
    .max(20_000)
    .optional()
    .describe('Chancellor plan JSON to provide strategic context.'),
  session_id: z
    .string()
    .uuid()
    .optional()
    .describe('Existing session ID (UUID) to attach this execution to.'),
};

export const delegateToAideSchema = {
  task: z
    .string()
    .min(1)
    .max(2_000)
    .describe(
      'A simple, well-defined task for the Aide: formatting, transformation, utilities.',
    ),
  task_id: z
    .string()
    .uuid()
    .optional()
    .describe('Unique task identifier (UUID). Auto-generated if omitted.'),
  context: z
    .string()
    .max(5_000)
    .optional()
    .describe('Minimal context the Aide needs to complete the task.'),
  session_id: z
    .string()
    .uuid()
    .optional()
    .describe('Existing session ID (UUID) to attach this result to.'),
};

export const getCouncilStateSchema = {
  session_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Specific session ID (UUID) to retrieve. Omit to list all active sessions.',
    ),
};
