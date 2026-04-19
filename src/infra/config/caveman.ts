// Caveman token-compression config.
// Inspired by https://github.com/JuliusBrussee/caveman
//
// When COUNCIL_CAVEMAN is set, a compression prefix is prepended to each
// internal agent's system prompt, instructing the model to respond in
// terse, filler-free language. Benchmarks show 65-75% output token savings
// with no loss of technical accuracy.
//
// Applies to Chancellor, Executor, Aide.
// Does NOT apply to Supervisor — its "recommendation" field is user-facing.
//
// COUNCIL_CAVEMAN values:
//   off    — no compression (default)
//   lite   — drop filler/pleasantries, keep grammar
//   full   — drop articles, use fragments (recommended)
//   ultra  — telegraphic abbreviations, maximum compression

export type CavemanMode = 'off' | 'lite' | 'full' | 'ultra';

export const VALID_CAVEMAN_MODES: CavemanMode[] = ['off', 'lite', 'full', 'ultra'];

/**
 * Reads and validates the COUNCIL_CAVEMAN environment variable.
 * Falls back to 'off' for unknown values (with a warning already logged at startup).
 */
export function resolveCavemanMode(): CavemanMode {
  const raw = (process.env['COUNCIL_CAVEMAN'] ?? 'off').toLowerCase();
  if ((VALID_CAVEMAN_MODES as string[]).includes(raw)) {
    return raw as CavemanMode;
  }
  return 'off';
}

// Resolved once per process — env vars don't change at runtime.
export const CAVEMAN_MODE: CavemanMode = resolveCavemanMode();

const CAVEMAN_PREFIXES: Record<Exclude<CavemanMode, 'off'>, string> = {
  lite: `RESPONSE STYLE (caveman-lite): Drop all filler words, pleasantries, preambles, and sign-offs. Keep grammatically correct sentences. No "Certainly!", no "Great question!", no "In summary". Lead with substance. Every sentence must add information.

`,

  full: `RESPONSE STYLE (caveman-full): Respond in compressed caveman-speak. Drop articles (a, an, the), filler, pleasantries, preambles, conjunctions where removable. Use fragments. Pack maximum meaning per token. Example: "Plan has 3 steps. Step 1: analyse schema. Step 2: write migration. Step 3: verify rollback." Full technical accuracy required — compression only removes padding, never substance.

`,

  ultra: `RESPONSE STYLE (caveman-ultra): Maximum token compression. Telegraphic. Drop articles, conjunctions, filler. Abbreviate where unambiguous (impl, config, fn, msg, err, req, resp, auth). Use symbols where clear (-> for "leads to", + for "and"). Sentence fragments only. No pleasantries. No preamble. No sign-off. Example: "3 steps: 1. analyse schema -> find FK deps. 2. write migration + rollback. 3. verify in staging." Technical accuracy must be 100%.

`,
};

/**
 * Prepends the appropriate caveman compression instruction to a system prompt.
 * Returns the original prompt unchanged when mode is 'off'.
 */
export function applyCaveman(systemPrompt: string, mode: CavemanMode = CAVEMAN_MODE): string {
  if (mode === 'off') return systemPrompt;
  return CAVEMAN_PREFIXES[mode] + systemPrompt;
}
