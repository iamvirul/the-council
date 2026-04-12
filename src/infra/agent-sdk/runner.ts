// Runs Claude sub-agents by invoking the claude CLI directly as a subprocess.
// This works with both OAuth (Claude.ai subscription) and ANTHROPIC_API_KEY,
// so no separate API key is needed if Claude Code is already installed.
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, rmdirSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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

// Resolve the claude binary once at startup.
function resolveClaude(): string {
  // Prefer explicit env override
  if (process.env['CLAUDE_PATH']) return process.env['CLAUDE_PATH'];

  // Common install locations
  const candidates = [
    `${process.env['HOME'] ?? ''}/.local/bin/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];

  for (const c of candidates) {
    try {
      execSync(`"${c}" --version`, { stdio: 'ignore' });
      return c;
    } catch {
      // not found here, try next
    }
  }

  // Fall back to PATH
  try {
    const found = execSync('which claude', { encoding: 'utf8' }).trim();
    if (found) return found;
  } catch {
    // not in PATH either
  }

  throw new CouncilError(
    'claude CLI not found. Install Claude Code or set CLAUDE_PATH to the claude binary.',
    'AGENT_SDK_ERROR',
  );
}

const CLAUDE_BIN = resolveClaude();
logger.info({ claude: CLAUDE_BIN }, 'claude CLI resolved');

/**
 * Runs a Claude sub-agent via the claude CLI and returns the final result text.
 * Works with OAuth (Claude.ai subscription) and ANTHROPIC_API_KEY — no extra cost
 * if Claude Code is already installed.
 */
export async function runAgent(params: RunAgentParams): Promise<string> {
  const { role, model, systemPrompt, userMessage, maxTurns, tools = [] } = params;

  logger.info({ role, model, toolCount: tools.length }, 'Invoking council agent');

  // Write system prompt to a temp file to avoid shell arg length/escaping issues
  const tmpDir = mkdtempSync(join(tmpdir(), 'council-'));
  const systemPromptFile = join(tmpDir, 'system.txt');
  writeFileSync(systemPromptFile, systemPrompt, 'utf8');

  const args = [
    '-p', userMessage,
    '--model', model,
    '--system-prompt-file', systemPromptFile,
    '--output-format', 'text',
  ];

  if (tools.length > 0) {
    args.push('--allowedTools', tools.join(','));
  }

  // maxTurns is not a CLI flag — agents return in a single turn given a
  // clear JSON output schema. Log it for observability only.
  logger.debug({ role, maxTurns }, 'maxTurns is advisory; claude CLI manages its own turn budget');

  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const proc = spawn(CLAUDE_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    proc.on('error', (err) => {
      reject(new CouncilError(
        `Failed to spawn claude CLI for ${role}: ${err.message}`,
        'AGENT_SDK_ERROR',
        role,
        err,
      ));
    });

    proc.on('close', (code) => {
      // Clean up temp files regardless of outcome
      try { unlinkSync(systemPromptFile); } catch { /* ignore */ }
      try { rmdirSync(tmpDir); } catch { /* ignore */ }

      const out = Buffer.concat(stdout).toString('utf8').trim();
      const err = Buffer.concat(stderr).toString('utf8').trim();

      if (code !== 0) {
        logger.error({ role, code, stderr: err.slice(0, 500) }, 'claude CLI exited with error');
        reject(new CouncilError(
          `claude CLI failed for ${role} (exit ${code}): ${err.slice(0, 300)}`,
          'AGENT_SDK_ERROR',
          role,
        ));
        return;
      }

      if (!out) {
        reject(new CouncilError(
          `Agent ${role} returned no output`,
          'AGENT_SDK_ERROR',
          role,
        ));
        return;
      }

      logger.info({ role }, 'Agent completed successfully');
      resolve(out);
    });
  });
}

// Convenience wrapper for the Executor — pre-configured with coding tools.
export async function runExecutorWithTools(params: RunAgentParams): Promise<string> {
  return runAgent({
    ...params,
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
  });
}
