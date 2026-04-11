// Structured logger (pino).
// CRITICAL: MCP servers use stdout for JSON-RPC. ALL logs MUST go to stderr.
import pino from 'pino';

export const logger = pino(
  {
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: { service: 'the-council' },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
    },
  },
  pino.destination({ dest: 2, sync: false }), // fd 2 = stderr
);
