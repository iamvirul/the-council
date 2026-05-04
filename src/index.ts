#!/usr/bin/env node
import { execSync } from 'child_process';

// council-mcp spawns sub-agents via the claude CLI, which uses your existing
// Claude Code session — no separate API key needed.
//
// If ANTHROPIC_API_KEY is set it will also be picked up automatically by the
// Agent SDK (useful for CI or non-interactive environments).

function findClaude(): boolean {
  try {
    execSync('claude --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!process.env['ANTHROPIC_API_KEY'] && !findClaude()) {
  process.stderr.write(
    [
      'Error: claude CLI not found and ANTHROPIC_API_KEY is not set.',
      '',
      'council-mcp needs one of:',
      '  1. Claude Code installed and "claude" in PATH (uses your existing session, no extra cost)',
      '  2. ANTHROPIC_API_KEY set in the MCP server env config',
      '',
      'For option 1, add the claude CLI directory to PATH in your MCP config:',
      '  {',
      '    "mcpServers": {',
      '      "the-council": {',
      '        "command": "npx",',
      '        "args": ["-y", "council-mcp"],',
      '        "env": { "PATH": "/path/to/claude/bin:/usr/local/bin:/usr/bin:/bin" }',
      '      }',
      '    }',
      '  }',
      '',
      'Run the install script to configure this automatically:',
      '  curl -fsSL https://raw.githubusercontent.com/iamvirul/the-council/main/install.sh | bash',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

// Validate COUNCIL_PERSIST value early so misconfiguration fails fast.
const persistMode = (process.env['COUNCIL_PERSIST'] ?? 'memory').toLowerCase();
if (!['memory', 'file', 'sqlite'].includes(persistMode)) {
  process.stderr.write(
    `Warning: unknown COUNCIL_PERSIST="${persistMode}" — falling back to memory.\n` +
    `Valid values: memory | file | sqlite\n`,
  );
}

// Validate COUNCIL_CAVEMAN value early — unknown values default to 'off'.
const cavemanMode = (process.env['COUNCIL_CAVEMAN'] ?? 'off').toLowerCase();
if (!['off', 'lite', 'full', 'ultra'].includes(cavemanMode)) {
  process.stderr.write(
    `Warning: unknown COUNCIL_CAVEMAN="${cavemanMode}" — falling back to off.\n` +
    `Valid values: off | lite | full | ultra\n`,
  );
}

// Validate COUNCIL_AGENT_TIMEOUT_MS early — invalid values fall back to 120s default.
const rawTimeout = process.env['COUNCIL_AGENT_TIMEOUT_MS'];
if (rawTimeout !== undefined && rawTimeout.trim() !== '') {
  const parsed = Number(rawTimeout);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    process.stderr.write(
      `Warning: invalid COUNCIL_AGENT_TIMEOUT_MS="${rawTimeout}" — falling back to 120000ms.\n` +
      `Must be a positive integer in milliseconds (min: 10000, max: 600000).\n`,
    );
  }
}

import { startServer } from './mcp/server/index.js';

startServer().catch((err: unknown) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
