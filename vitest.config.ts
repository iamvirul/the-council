import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // MCP servers are stdio-sensitive — silence test logs from pino going to
    // stderr would be nice but is non-trivial. Acceptable noise during tests.
  },
});
