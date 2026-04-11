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
}

/**
 * Runs a Claude sub-agent via the Agent SDK and returns the final result text.
 * The agent is expected to return a JSON string as its final result.
 */
export async function runAgent(params: RunAgentParams): Promise<string> {
  const { role, model, systemPrompt, userMessage, maxTurns } = params;

  logger.info({ role, model }, 'Invoking council agent');

  let result: string | undefined;

  try {
    for await (const message of query({
      prompt: userMessage,
      options: {
        model,
        systemPrompt,
        maxTurns,
        // Council agents reason and respond — no filesystem/shell tools needed.
        // The Executor can be given tools by the caller if needed for implementation.
        allowedTools: [],
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

/**
 * Runs the Executor agent with full coding tools so it can actually implement tasks.
 */
export async function runExecutorWithTools(params: RunAgentParams): Promise<string> {
  const { role, model, systemPrompt, userMessage, maxTurns } = params;

  logger.info({ role, model }, 'Invoking executor agent with tools');

  let result: string | undefined;

  try {
    for await (const message of query({
      prompt: userMessage,
      options: {
        model,
        systemPrompt,
        maxTurns,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      },
    })) {
      if ('result' in message) {
        result = message.result;
      }
    }
  } catch (err) {
    logger.error({ role, err }, 'Executor agent SDK call failed');
    throw new CouncilError(
      `Executor agent SDK call failed: ${err instanceof Error ? err.message : String(err)}`,
      'AGENT_SDK_ERROR',
      role,
      err,
    );
  }

  if (result === undefined || result.trim() === '') {
    throw new CouncilError(
      'Executor returned no result',
      'AGENT_SDK_ERROR',
      role,
    );
  }

  logger.info({ role }, 'Executor completed successfully');
  return result;
}
