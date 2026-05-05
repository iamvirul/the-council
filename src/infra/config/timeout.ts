// Per-agent subprocess timeout config.
//
// When COUNCIL_AGENT_TIMEOUT_MS is set, each claude CLI subprocess is given
// that budget. On expiry the process receives SIGTERM (2s grace) then SIGKILL,
// and an AGENT_TIMEOUT CouncilError is thrown. This feeds into withAgentRetry,
// which may retry the call up to DEFAULT_RETRY_OPTIONS.maxAttempts times.
//
// Default: 120_000ms (2 min) — ample for Opus multi-turn calls.
// Min: 10_000ms  — below this retries become counterproductive.
// Max: 600_000ms — 10 min hard ceiling to bound worst-case pipeline duration.

import { logger } from '../logging/logger.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 600_000;

export function resolveAgentTimeoutMs(): number {
  const raw = process.env['COUNCIL_AGENT_TIMEOUT_MS'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    logger.warn(
      { COUNCIL_AGENT_TIMEOUT_MS: raw, fallback: DEFAULT_TIMEOUT_MS },
      'COUNCIL_AGENT_TIMEOUT_MS is not an integer — using default',
    );
    return DEFAULT_TIMEOUT_MS;
  }

  if (parsed < MIN_TIMEOUT_MS) {
    logger.warn(
      { COUNCIL_AGENT_TIMEOUT_MS: raw, clamped_to: MIN_TIMEOUT_MS },
      'COUNCIL_AGENT_TIMEOUT_MS below minimum — clamped to 10s',
    );
    return MIN_TIMEOUT_MS;
  }

  if (parsed > MAX_TIMEOUT_MS) {
    logger.warn(
      { COUNCIL_AGENT_TIMEOUT_MS: raw, clamped_to: MAX_TIMEOUT_MS },
      'COUNCIL_AGENT_TIMEOUT_MS above ceiling — clamped to 600s',
    );
    return MAX_TIMEOUT_MS;
  }

  return parsed;
}

export const AGENT_TIMEOUT_MS: number = resolveAgentTimeoutMs();
