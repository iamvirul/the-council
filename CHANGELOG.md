# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Supervisor evaluation loop** — the Supervisor is now an active quality gate, not advisory only. When it rejects an agent output (`approved: false`), the orchestrator re-invokes the agent with the flags and recommendation appended as feedback, up to `COUNCIL_EVAL_RETRIES` times (default: 2 → 3 total attempts). If the retry budget is exhausted and the output is still flagged, the result is surfaced anyway with the flags visible — no silent passes.
- `COUNCIL_EVAL_RETRIES` env var — clamped to `[0, 5]`. Set to `0` to restore pre-0.5 advisory-only behaviour. Non-integer values fall back to the default.
- Retry count recorded in `session.metrics.eval_retries`, visible via `get_council_state` and in the result summary footer.
- `supervisor_feedback` field added to `AgentInvokeOptions`; Executor and Aide prompts render a clearly-delimited `--- SUPERVISOR FEEDBACK ---` block when set.

## [0.4.0] - 2026-04-20

### Added
- **Per-agent tool access** — Chancellor and Aide now have tool access, configurable via `AGENT_TOOLS` constants:
  - Chancellor: `Read`, `Glob`, `Grep` (read-only — inspects codebase before planning, never writes)
  - Executor: `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep` (unchanged)
  - Aide: `Read` (can read files before transforming them)
  - Supervisor: none (pure review, no side effects)
- `AGENT_TOOLS` constant in `src/domain/constants/index.ts` — single source of truth for all per-agent tool sets
- Chancellor and Aide system prompts updated to describe their tool capabilities and when to use them
- Removed `runExecutorWithTools` convenience wrapper — Executor now uses `runAgent` + `AGENT_TOOLS.EXECUTOR` directly, consistent with all other agents
- **Caveman token compression** — reduce internal agent output tokens by 50-60% with no accuracy loss. Inspired by [Caveman](https://github.com/JuliusBrussee/caveman). Set `COUNCIL_CAVEMAN` in the MCP env block:
  - `off` (default) — no compression, unchanged behaviour
  - `lite` — drops filler and pleasantries, keeps grammar (~20% savings)
  - `full` — fragments, flat bullets, explicit 50% word budget (~50-60% savings, recommended)
  - `ultra` — telegraphic abbreviations and symbols (~60-70% savings)
- Compression applies to Chancellor, Executor, and Aide. Supervisor is exempt — its recommendation field is user-facing prose.
- Active mode recorded in `session.metrics.caveman_mode`, visible via `get_council_state`

## [0.3.0] - 2026-04-18

### Added
- **Persistent session memory** — sessions now survive MCP server restarts via an optional `COUNCIL_PERSIST` env var:
  - `memory` (default) — in-process LRU Map, no breaking change
  - `file` — JSON files at `~/.council/sessions/<id>.json`, zero dependencies
  - `sqlite` — SQLite at `~/.council/council.db` via `better-sqlite3`, WAL mode for safe concurrent access
- **`SessionStore` interface** — all backends implement a common contract; swappable without touching orchestration code
- **7-day session TTL** — file and SQLite backends auto-expire sessions older than 7 days on startup
- **Startup validation** — unknown `COUNCIL_PERSIST` values emit a warning and fall back to memory

## [0.2.3] - 2026-04-13

### Changed
- README diagrams replaced with hosted images — architecture, orchestration flow, and session lifecycle diagrams now render correctly on all platforms including GitHub, npm, and PyPI mirrors

## [0.2.2] - 2026-04-13

### Fixed
- `install.sh` now also runs `claude mcp add` to register the server with Claude Code CLI — previously only Claude Desktop was configured, so the tools were invisible in the CLI
- `install.ps1` rewritten to match: detects `claude` binary, falls back to `ANTHROPIC_API_KEY`, configures both Claude Desktop and Claude Code CLI
- `runner.ts` strips `ANTHROPIC_API_KEY` when set to an empty string — Claude Desktop injects an empty key into the MCP server env, causing the child `claude` process to attempt API key auth and fail with exit 1

## [0.2.1] - 2026-04-12

### Fixed
- Replace `@anthropic-ai/claude-agent-sdk` with direct `claude` CLI subprocess calls — eliminates 401 auth errors for users authenticated via Claude.ai OAuth (no separate API key needed)
- Use `--system-prompt-file` instead of `--system-prompt` CLI arg — prevents `exit 1` failures caused by long system prompts with XML tags and special characters
- Startup check fails fast with a clear message if `claude` CLI is not in PATH and no `ANTHROPIC_API_KEY` is set
- `install.sh` and `install.ps1` now detect the `claude` binary location and add its directory to the MCP server PATH automatically

## [0.2.0] - 2026-04-12

### Added
- **Supervisor agent** (Claude Haiku 4.5) — reviews every Executor step result and Aide task output before they surface to the caller. Non-blocking: if the Supervisor errors, orchestration continues and a warning is logged.
- **`get_supervisor_verdicts` MCP tool** — retrieve all Supervisor verdicts for a session, with optional `flagged_only` filter for quick triage
- **Supervisor flags in result summary** — flagged outputs appear under a `## Supervisor Flags` section in the `orchestrate` result
- **`supervisor` added to `AgentRole`** — session metrics now track Supervisor invocations alongside Chancellor, Executor, and Aide
- **PR template** — standardised pull request checklist for contributions
- **Issue templates** — bug report and feature request templates; security reports redirect to GitHub Security Advisories
- **`CODEOWNERS`** — `@iamvirul` set as required reviewer on all files

## [0.1.2] - 2026-04-12

### Fixed
- Release workflow now reconfigures npm registry to `npm.pkg.github.com` before publishing to GitHub Packages, fixing `ENEEDAUTH` on the GitHub Packages publish step

## [0.1.1] - 2026-04-12

### Added
- Published to GitHub Packages as `@iamvirul/council-mcp` in addition to npm — package now appears in the GitHub repository sidebar

### Security
- Zod runtime schema validation on all agent JSON responses — prevents malformed or injected agent output from propagating to downstream agents
- Hard cap of 10 delegated tasks per Executor response — prevents prompt-injection-driven Aide invocation amplification
- UUID format validation on `session_id` and `task_id` MCP tool inputs
- Max length limits added to `context` and `plan_context` tool input fields (previously unbounded)
- Code fence extraction regex corrected — non-greedy match prevents incorrect JSON extraction from multi-fence responses
- Silent `catch {}` blocks replaced with `logger.warn` — state recording failures now visible in logs
- Pino async destination flushed on `beforeExit`, `uncaughtException`, and `unhandledRejection` — prevents log loss on crash

## [0.1.0] - 2026-04-11

### Added
- **MCP server** with five tools: `orchestrate`, `consult_chancellor`, `execute_with_executor`, `delegate_to_aide`, `get_council_state`
- **Chancellor agent** (Claude Opus 4.6) — strategic analysis, risk assessment, and step-by-step planning via the Agent SDK
- **Executor agent** (Claude Sonnet 4.6) — plan implementation with access to `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep` tools
- **Aide agent** (Claude Haiku 4.5) — simple tasks: formatting, data transformation, utilities
- **Complexity-based routing** in `orchestrate` — trivial problems go to Aide, simple to Executor, complex through the full Chancellor → Executor → Aide pipeline
- **In-memory session state** with LRU eviction cap of 500 sessions to prevent OOM
- **Structured JSON logging** via pino to stderr (stdout reserved for MCP JSON-RPC)
- **Graceful shutdown** on `SIGINT`/`SIGTERM`
- **GitHub Actions workflows**: CI (type-check + build + audit), PR check, and release (GitHub Release + npm publish with provenance)
- MIT license

### Security
- All logs routed to stderr — MCP stdout never contaminated
- Stack traces never exposed to MCP tool callers
- Session IDs generated with `crypto.randomUUID()`
- Executor runs with explicit `permissionMode: 'acceptEdits'` rather than relying on inherited default
- `@anthropic-ai/claude-agent-sdk` pinned to `^0.2.101` (no `latest` in production)

[Unreleased]: https://github.com/iamvirul/the-council/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/iamvirul/the-council/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/iamvirul/the-council/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/iamvirul/the-council/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/iamvirul/the-council/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/iamvirul/the-council/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/iamvirul/the-council/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/iamvirul/the-council/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/iamvirul/the-council/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/iamvirul/the-council/releases/tag/v0.1.0
