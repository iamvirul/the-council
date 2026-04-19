// Caveman token-compression config.
// Inspired by https://github.com/JuliusBrussee/caveman
//
// Appended as a SUFFIX to each internal agent's system prompt — placed after
// the output schema so it governs how the model fills JSON string fields.
// Suffix placement is critical: a prefix loses effectiveness because the later
// JSON schema instruction pulls the model back to verbose prose.
//
// Measured token savings on internal agent JSON responses:
//   lite   — ~20% savings  (filler removed, grammar intact)
//   full   — ~50-60% savings (fragments, bullets, word budget enforced)
//   ultra  — ~60-70% savings (telegraphic, abbreviations, symbols)
//
// Applies to: Chancellor, Executor, Aide (internal pipeline).
// Skipped for: Supervisor — its "recommendation" field is user-facing prose.
//
// COUNCIL_CAVEMAN values:
//   off    — no compression (default)
//   lite   — drop filler/pleasantries, keep grammar
//   full   — fragments, flat bullets, 50% word budget (recommended)
//   ultra  — telegraphic, abbreviations, symbols, maximum compression

export type CavemanMode = 'off' | 'lite' | 'full' | 'ultra';

export const VALID_CAVEMAN_MODES: CavemanMode[] = ['off', 'lite', 'full', 'ultra'];

/**
 * Reads and validates the COUNCIL_CAVEMAN environment variable.
 * Falls back to 'off' for unknown values (warning logged at startup).
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

// ─── Compression suffixes ─────────────────────────────────────────────────────
// Placed AFTER the output schema so the compression rule is the last thing the
// model reads before generating — it overrides the natural pull toward full prose.
// Each suffix includes JSON-field-specific before/after examples so the model
// knows exactly what "compressed" means inside a string value.

const CAVEMAN_SUFFIXES: Record<Exclude<CavemanMode, 'off'>, string> = {
  lite: `

---
COMPRESSION RULE (applies to all JSON string field values above):
Drop filler words, pleasantries, preambles, and sign-offs. Keep grammatically correct sentences. No padding. Lead with substance.

Before: "The analysis reveals that this is fundamentally a data consistency problem that requires careful consideration."
After:  "This is a data consistency problem requiring careful handling."

Every string value in your JSON response must follow this rule.`,

  full: `

---
COMPRESSION RULE - TARGET 50% FEWER WORDS (applies to every JSON string field):
Write compressed caveman-speak. Drop articles (a/an/the), filler, preambles. Use fragments and flat bullet points. Prefer "X -> Y" over "X leads to Y". Pack maximum meaning per token. No pleasantries. No padding. No redundant headers.

WORD BUDGET: Your full JSON response must use at most 50% of the words you would write without this rule. Count mentally. Cut aggressively.

STRUCTURE COMPRESSION — replace prose paragraphs with flat bullets:
Before: "## What is an Index?\\n\\nA database index is a data structure that maps column values to their row locations, allowing the database engine to find data without scanning every row..."
After:  "Index = data structure mapping col values -> row locations. Avoids full table scan."

SENTENCE COMPRESSION — strip every removable word:
Before: "The primary risk is that the migration could fail midway through execution, leaving the database in an inconsistent state that would require manual intervention to resolve."
After:  "Risk: migration fails mid-exec -> DB inconsistent -> manual fix needed."

Before: "I recommend implementing a retry mechanism with exponential backoff to handle transient network failures."
After:  "Impl retry + exponential backoff for transient network failures."

SHORT FIELDS (approach, quality_check.notes): max 20 words. Cut to essentials only.
LONG FIELDS (result, analysis): max 50% of normal. Use bullets, not paragraphs.`,

  ultra: `

---
COMPRESSION RULE (applies to all JSON string field values above):
Maximum compression inside every JSON string field. Telegraphic. Drop articles, conjunctions, filler. Abbreviate where unambiguous: impl=implement, config=configuration, fn=function, msg=message, err=error, req=request, resp=response, auth=authentication, db=database, tx=transaction, dep=dependency, perf=performance. Use symbols: ->=leads to, +=and, ~=approximately, !=not.

Before: "The analysis reveals that this is fundamentally a data consistency problem that will require careful consideration of the transaction boundaries and rollback strategy across all services."
After:  "Data consistency problem. Needs careful tx boundary + rollback design across services."

Before: "The primary risk is that the migration could fail midway through execution, leaving the database in an inconsistent state that would require manual intervention to resolve."
After:  "Risk: migration fails mid-exec -> DB inconsistent state -> manual fix needed."

Before: "I recommend implementing a retry mechanism with exponential backoff to handle transient network failures gracefully."
After:  "Impl retry + exponential backoff for transient network errs."

Every string value in your JSON response must follow this rule. Target: one-third the words, zero information loss.`,
};

/**
 * Appends the caveman compression instruction after the system prompt.
 * Suffix placement ensures it fires after the JSON schema instruction,
 * giving it authority over how string field values are written.
 * Returns the original prompt unchanged when mode is 'off'.
 */
export function applyCaveman(systemPrompt: string, mode: CavemanMode = CAVEMAN_MODE): string {
  if (mode === 'off') return systemPrompt;
  return systemPrompt + CAVEMAN_SUFFIXES[mode];
}
