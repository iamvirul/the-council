#!/usr/bin/env node
import { startServer } from './mcp/server/index.js';

startServer().catch((err: unknown) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
