// Wrapper around the Claude Agent SDK's query() function.
// Each agent (Chancellor, Executor, Aide) is invoked as a sub-agent that
// inherits the Claude Code session — no separate API key required.
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRole } from '../../domain/models/types.js';
import { CouncilError } from '../../domain/models/types.js';
import { logger } from '../logging/logger.js';

export interface RunAgentParams {
  role: AgentRole;
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTurns: number;
  /** Tools the sub-agent is allowed to use. Defaults to [] (reasoning only). */
  tools?: string[];
}

/**
 * Runs a Claude sub-agent via the Agent SDK and returns the final result text.
 * The agent is expected to return a JSON string as its final result.
 *
 * Chancellor and Aide receive no tools (pure reasoning).
 * Executor receives file/shell tools when tools param is provided.
 */
export async function runAgent(params: RunAgentParams): Promise<string> {
  const { role, model, systemPrompt, userMessage, maxTurns, tools = [] } = params;

  logger.info({ role, model, toolCount: tools.length }, 'Invoking council agent');

  let result: string | undefined;

  try {
    for await (const message of query({
      prompt: userMessage,
      options: {
        model,
        systemPrompt,
        maxTurns,
        allowedTools: tools,
        // Explicit permission mode: acceptEdits avoids interactive prompts in
        // automated orchestration while still scoping to the declared allowedTools.
        permissionMode: tools.length > 0 ? 'acceptEdits' : 'default',
      },
    })) {
      if ('result' in message) {
        result = message.result;
      }
    }
  } catch (err) {
    logger.error({ role, err }, 'Agent SDK call failed');
    throw new CouncilError(
      `Agent SDK call failed for ${role}: ${err instanceof Error ? err.message : String(err)}`,
      'AGENT_SDK_ERROR',
      role,
      err,
    );
  }

  if (result === undefined || result.trim() === '') {
    throw new CouncilError(
      `Agent ${role} returned no result`,
      'AGENT_SDK_ERROR',
      role,
    );
  }

  logger.info({ role }, 'Agent completed successfully');
  return result;
}

// Convenience wrapper for the Executor — pre-configured with coding tools.
export async function runExecutorWithTools(params: RunAgentParams): Promise<string> {
  return runAgent({
    ...params,
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
  });
}
