// Structured logger (pino).
// CRITICAL: MCP servers use stdout for JSON-RPC. ALL logs MUST go to stderr.
import pino from 'pino';

const destination = pino.destination({ dest: 2, sync: false }); // fd 2 = stderr

export const logger = pino(
  {
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: { service: 'the-council' },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
    },
  },
  destination,
);

// Flush buffered log entries before process exit so async logs are not dropped
// on crash. Without this, pino's async destination can lose the last N entries.
function flushAndExit(err: Error | null, exitCode: number): void {
  if (err) logger.error({ err }, 'fatal error before exit');
  destination.flushSync();
  process.exit(exitCode);
}

process.on('beforeExit', () => destination.flushSync());
process.on('uncaughtException', (err: Error) => {
  logger.error({ err }, 'uncaughtException');
  flushAndExit(err, 1);
});
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err }, 'unhandledRejection');
  flushAndExit(err, 1);
});
