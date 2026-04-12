#!/usr/bin/env node

// council-mcp runs as a standalone npx process — it is NOT inside Claude Code's
// process space. The Agent SDK needs ANTHROPIC_API_KEY in its own environment.
if (!process.env['ANTHROPIC_API_KEY']) {
  process.stderr.write(
    [
      'Error: ANTHROPIC_API_KEY is not set.',
      '',
      'council-mcp runs as a separate process and needs its own API key.',
      'Add it to your MCP config:',
      '',
      '  {',
      '    "mcpServers": {',
      '      "the-council": {',
      '        "command": "npx",',
      '        "args": ["-y", "council-mcp"],',
      '        "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }',
      '      }',
      '    }',
      '  }',
      '',
      'Get a key at https://console.anthropic.com',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

import { startServer } from './mcp/server/index.js';

startServer().catch((err: unknown) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
