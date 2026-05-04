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
import { applyCaveman, CAVEMAN_MODE } from '../config/caveman.js';
import { AGENT_TIMEOUT_MS } from '../config/timeout.js';

export interface RunAgentParams {
  role: AgentRole;
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTurns: number;
  /** Tools the sub-agent is allowed to use. Defaults to [] (reasoning only). */
  tools?: string[];
  /**
   * When true, skips caveman compression regardless of COUNCIL_CAVEMAN.
   * Set for the Supervisor — its recommendation field is user-facing prose.
   */
  skipCaveman?: boolean;
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
 * Invoke the Claude CLI as a sub-agent to produce the agent's final text output.
 *
 * This will run the installed `claude` binary with the provided prompts and options. If
 * `ANTHROPIC_API_KEY` is unset or empty in the environment passed to this process, the
 * key is removed for the child process so the CLI falls back to any configured OAuth
 * (Claude Code) session.
 *
 * @param params.tools - Optional list of tool names to permit; when empty, no `--allowedTools` flag is passed
 * @param params.skipCaveman - When true, do not apply caveman compression to the system prompt
 * @returns The trimmed text output produced by the Claude CLI
 * @throws {CouncilError} On spawn failures, non-zero CLI exit codes, or when the agent returns no output
 */
export async function runAgent(params: RunAgentParams): Promise<string> {
  const { role, model, systemPrompt, userMessage, maxTurns, tools = [], skipCaveman = false } = params;

  logger.info({ role, model, toolCount: tools.length, cavemanMode: skipCaveman ? 'off' : CAVEMAN_MODE }, 'Invoking council agent');

  // Apply caveman compression to the system prompt unless this agent is exempt.
  const effectiveSystemPrompt = skipCaveman ? systemPrompt : applyCaveman(systemPrompt);

  // Write system prompt to a temp file to avoid shell arg length/escaping issues
  const tmpDir = mkdtempSync(join(tmpdir(), 'council-'));
  const systemPromptFile = join(tmpDir, 'system.txt');
  writeFileSync(systemPromptFile, effectiveSystemPrompt, 'utf8');

  const args = [
    '-p', userMessage,
    '--model', model,
    '--system-prompt-file', systemPromptFile,
    '--output-format', 'text',
    '--dangerously-skip-permissions',
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

    // Strip ANTHROPIC_API_KEY if it is empty — an empty key causes the claude
    // CLI to attempt API-key auth and fail. When omitted, claude falls back to
    // its stored OAuth session (Claude Code subscription).
    const childEnv = { ...process.env };
    if (!childEnv['ANTHROPIC_API_KEY']) {
      delete childEnv['ANTHROPIC_API_KEY'];
    }

    const proc = spawn(CLAUDE_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });

    // Per-agent hard timeout — SIGTERM + 2s grace then SIGKILL.
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* already gone */ } }, 2_000);
      reject(new CouncilError(
        `Agent ${role} timed out after ${AGENT_TIMEOUT_MS}ms`,
        'AGENT_TIMEOUT',
        role,
      ));
    }, AGENT_TIMEOUT_MS);

    proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(new CouncilError(
        `Failed to spawn claude CLI for ${role}: ${err.message}`,
        'AGENT_SDK_ERROR',
        role,
        err,
      ));
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);

      // Always clean up temp files — even on timeout, the process has now
      // closed so the files are safe to remove.
      try { unlinkSync(systemPromptFile); } catch { /* ignore */ }
      try { rmdirSync(tmpDir); } catch { /* ignore */ }

      if (timedOut) return; // timeout already rejected — don't double-reject

      const out = Buffer.concat(stdout).toString('utf8').trim();
      const err = Buffer.concat(stderr).toString('utf8').trim();

      if (code !== 0) {
        logger.error({
          role,
          code,
          stderr: err.slice(0, 500),
          stdout: out.slice(0, 500),
          claudeBin: CLAUDE_BIN,
          args,
        }, 'claude CLI exited with error');
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
