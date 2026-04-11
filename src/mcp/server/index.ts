import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { orchestrate } from '../../application/orchestrator/index.js';
import { invokeChancellor } from '../../application/chancellor/agent.js';
import { invokeExecutor } from '../../application/executor/agent.js';
import { invokeAide } from '../../application/aide/agent.js';
import { stateStore } from '../../infra/state/council-state.js';
import { logger } from '../../infra/logging/logger.js';
import { CouncilError } from '../../domain/models/types.js';
import {
  orchestrateSchema,
  consultChancellorSchema,
  executeWithExecutorSchema,
  delegateToAideSchema,
  getCouncilStateSchema,
} from '../tools/definitions.js';

// ─── Error response helper ────────────────────────────────────────────────────

function errorResponse(err: unknown) {
  const message =
    err instanceof CouncilError
      ? `[${err.code}] ${err.message}`
      : err instanceof Error
        ? err.message
        : 'An unexpected error occurred';

  // Never expose stack traces to MCP callers
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// ─── Server setup ─────────────────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  const server = new McpServer({
    name: 'the-council',
    version: '0.1.0',
  });

  // ── Tool: orchestrate ───────────────────────────────────────────────────────
  server.tool(
    'orchestrate',
    'Route a problem through The Council. Complex problems invoke the Chancellor for planning then the Executor for implementation. Simple problems go straight to the Executor. Trivial tasks go to the Aide. Returns the full result plus a session ID for follow-up.',
    orchestrateSchema,
    async ({ problem }) => {
      try {
        const result = await orchestrate(problem);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error({ err }, 'orchestrate tool error');
        return errorResponse(err);
      }
    },
  );

  // ── Tool: consult_chancellor ────────────────────────────────────────────────
  server.tool(
    'consult_chancellor',
    'Invoke the Chancellor (Claude Opus) directly for deep strategic analysis and planning. Returns a structured plan with steps, risks, and delegation guidance.',
    consultChancellorSchema,
    async ({ problem, context }) => {
      try {
        const response = await invokeChancellor({ problem, context });
        return {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
        };
      } catch (err) {
        logger.error({ err }, 'consult_chancellor tool error');
        return errorResponse(err);
      }
    },
  );

  // ── Tool: execute_with_executor ─────────────────────────────────────────────
  server.tool(
    'execute_with_executor',
    'Invoke the Executor (Claude Sonnet) directly for plan implementation. Provide the task and optionally a Chancellor plan as context. The Executor has access to Read, Write, Edit, Bash, Glob, and Grep tools.',
    executeWithExecutorSchema,
    async ({ task, plan_context, session_id }) => {
      try {
        const response = await invokeExecutor({
          problem: task,
          context: plan_context,
        });

        if (session_id) {
          try {
            stateStore.recordAgentCall(session_id, 'executor');
            stateStore.recordExecutorResult(session_id, response);
          } catch {
            // Session may not exist — non-fatal
          }
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
        };
      } catch (err) {
        logger.error({ err }, 'execute_with_executor tool error');
        return errorResponse(err);
      }
    },
  );

  // ── Tool: delegate_to_aide ──────────────────────────────────────────────────
  server.tool(
    'delegate_to_aide',
    'Invoke the Aide (Claude Haiku) for simple, well-defined tasks: formatting, data transformation, text processing, simple utilities. Fast and cost-efficient.',
    delegateToAideSchema,
    async ({ task, task_id, context, session_id }) => {
      try {
        const resolvedTaskId = task_id ?? crypto.randomUUID();
        const response = await invokeAide(resolvedTaskId, { problem: task, context });

        if (session_id) {
          try {
            stateStore.recordAgentCall(session_id, 'aide');
            stateStore.recordAideResult(session_id, response);
          } catch {
            // Session may not exist — non-fatal
          }
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
        };
      } catch (err) {
        logger.error({ err }, 'delegate_to_aide tool error');
        return errorResponse(err);
      }
    },
  );

  // ── Tool: get_council_state ─────────────────────────────────────────────────
  server.tool(
    'get_council_state',
    'Retrieve the state of a Council session by ID, or list all active sessions if no ID is provided.',
    getCouncilStateSchema,
    async ({ session_id }) => {
      try {
        if (session_id) {
          const session = stateStore.get(session_id);
          return {
            content: [{ type: 'text', text: JSON.stringify(session, null, 2) }],
          };
        }

        const sessions = stateStore.list().map((s) => ({
          request_id: s.request_id,
          phase: s.phase,
          created_at: s.created_at,
          problem: s.problem.slice(0, 120) + (s.problem.length > 120 ? '…' : ''),
          agents_invoked: s.metrics.agents_invoked,
          total_agent_calls: s.metrics.total_agent_calls,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }],
        };
      } catch (err) {
        logger.error({ err }, 'get_council_state tool error');
        return errorResponse(err);
      }
    },
  );

  // ─── Transport & lifecycle ──────────────────────────────────────────────────
  const transport = new StdioServerTransport();

  process.on('SIGINT', async () => {
    logger.info('Shutting down (SIGINT)');
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Shutting down (SIGTERM)');
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
  logger.info('The Council MCP server running on stdio');
}
