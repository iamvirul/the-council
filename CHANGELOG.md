# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/iamvirul/the-council/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/iamvirul/the-council/releases/tag/v0.1.0
