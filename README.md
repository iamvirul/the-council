# The Council

[![npm version](https://img.shields.io/npm/v/council-mcp)](https://www.npmjs.com/package/council-mcp)
[![GitHub Packages](https://img.shields.io/badge/GitHub%20Packages-%40iamvirul%2Fcouncil--mcp-blue?logo=github)](https://github.com/iamvirul/the-council/pkgs/npm/council-mcp)
[![CI](https://github.com/iamvirul/the-council/actions/workflows/ci.yml/badge.svg)](https://github.com/iamvirul/the-council/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A four-tier AI agent orchestration system built as a Claude Code MCP server.

The Council is a TypeScript [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server with four Claude agents. When you give it a problem, it figures out the complexity and sends it to the right agents. A formatting task goes straight to the fast Aide (Haiku). A coding task goes to the Executor (Sonnet). A design or architecture problem first goes through the Chancellor (Opus) for a plan, then the Executor runs each step, delegating simple sub-tasks to the Aide. After each Executor or Aide output, the Supervisor (Haiku) acts as an active quality gate — rejecting outputs that miss the mark and triggering a retry with its feedback attached, up to a configurable limit.

Sub-agents run via the `claude` CLI — the same one Claude Code uses. **If you already have Claude Code installed, no separate API key or extra cost is needed.** The install script finds the `claude` binary and wires it up automatically. Alternatively, set `ANTHROPIC_API_KEY` in the MCP server env for CI or API-key-based setups.

---

## How It Works

<img width="1302" height="1507" alt="architechture" src="https://github.com/user-attachments/assets/835f09e8-7d5c-474b-900e-ecf7f5d87113" />


Complexity routing uses a fast keyword + word count check with no extra LLM call.

| Signal | Complexity | Agents invoked |
|---|---|---|
| Word count > 60, or keywords: `plan`, `design`, `architect`, `strategy`, `analyze`, `assess`, `risk` | Complex | Chancellor -> Executor -> Aide -> Supervisor |
| Word count 15-60, no strong signal | Simple | Executor -> Aide (as needed) -> Supervisor |
| Word count < 15, keywords: `format`, `convert`, `transform`, `clean`, `list`, `count` | Trivial | Aide -> Supervisor |

---

## Agent Roles

| Agent | Model | Role | Tools | Max turns |
|---|---|---|---|---|
| **Chancellor** | `claude-opus-4-6` | Deep analysis, planning, risk assessment | `Read`, `Glob`, `Grep` (read-only) | 3 |
| **Executor** | `claude-sonnet-4-6` | Implementation, code, delegation | `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep` | 10 |
| **Aide** | `claude-haiku-4-5` | Formatting, data transformation, utilities | `Read` | 3 |
| **Supervisor** | `claude-haiku-4-5` | Output review, quality flags, intent alignment | None (pure reasoning) | 2 |

By default the Supervisor is an **active quality gate**: when it rejects an output (`approved: false`), the orchestrator re-invokes the agent with the Supervisor's flags appended as feedback, up to `COUNCIL_EVAL_RETRIES` times (default 2 → 3 total attempts). If the output is still flagged after the retry budget is exhausted, the result is surfaced anyway with the flags visible — nothing is silently dropped. Set `COUNCIL_EVAL_RETRIES=0` to revert to pure-advisory mode. If the Supervisor itself errors, orchestration continues without a verdict and a warning is logged.

---

## Orchestration Flow

<img width="8192" height="5202" alt="Orchestration Flow" src="https://github.com/user-attachments/assets/aa2aaaba-bb20-4905-959f-546ccf63a2b5" />

---

## MCP Tools

| Tool | Description | Key inputs |
|---|---|---|
| `orchestrate` | Route a problem through The Council. Complexity is assessed automatically. | `problem` (string, max 10 000 chars) |
| `consult_chancellor` | Invoke the Chancellor directly for deep strategic analysis and a structured plan. | `problem`, `context?` |
| `execute_with_executor` | Invoke the Executor directly for implementation. Has file and shell tool access. | `task`, `plan_context?`, `session_id?` |
| `delegate_to_aide` | Invoke the Aide directly for simple, well-defined tasks. | `task` (max 2 000 chars), `task_id?`, `context?`, `session_id?` |
| `get_council_state` | Retrieve session state by ID, or list all active sessions. | `session_id?` |
| `get_supervisor_verdicts` | Retrieve Supervisor verdicts for a session. Use `flagged_only` to surface only issues. | `session_id`, `flagged_only?` |

---

## Installation

**Requirements:** Node.js 22+

### One-liner

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/iamvirul/the-council/main/install.sh | bash
```

**Windows (PowerShell)**
```powershell
irm https://raw.githubusercontent.com/iamvirul/the-council/main/install.ps1 | iex
```

Both scripts detect your `claude` CLI location and configure both **Claude Desktop** and **Claude Code CLI** automatically. No API key or extra cost if you already have Claude Code. Nothing is installed globally.

| Target | Config location |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code CLI | Registered via `claude mcp add` (project-scoped) |

Restart Claude Code after running the script.

### Manual setup

Add this to your Claude Code MCP config. Replace the PATH value with the directory containing your `claude` binary (run `which claude` to find it):

```json
{
  "mcpServers": {
    "the-council": {
      "command": "npx",
      "args": ["-y", "council-mcp"],
      "env": {
        "PATH": "/path/to/claude/bin:/usr/local/bin:/usr/bin:/bin"
      }
    }
  }
}
```

If you prefer API key auth instead, use `"ANTHROPIC_API_KEY": "sk-ant-..."` in the `env` block.

Restart Claude Code and the tools will appear.

### Persistent sessions (optional)

By default sessions are stored in memory and cleared when the MCP server restarts. To persist sessions across restarts, add `COUNCIL_PERSIST` to the env block:

| Value | Storage | Notes |
|---|---|---|
| `memory` | In-process (default) | Cleared on restart, no setup needed |
| `file` | `~/.council/sessions/<id>.json` | Zero dependencies, human-readable |
| `sqlite` | `~/.council/council.db` | Recommended — fast, transactional, concurrent-safe |

```json
{
  "mcpServers": {
    "the-council": {
      "command": "npx",
      "args": ["-y", "council-mcp"],
      "env": {
        "PATH": "/path/to/claude/bin:/usr/local/bin:/usr/bin:/bin",
        "COUNCIL_PERSIST": "sqlite"
      }
    }
  }
}
```

Sessions older than 7 days are automatically expired on startup and periodically in file and SQLite modes.

### Token compression (optional)

The Council can make multiple agent calls per orchestration. Enable Caveman compression to reduce output tokens from internal agents (Chancellor, Executor, Aide) by up to 50-60%, with no loss of technical accuracy. The Supervisor is exempt — its user-facing recommendation stays in normal prose.

Add `COUNCIL_CAVEMAN` to the env block:

| Value | Style | Measured savings |
|---|---|---|
| `off` | Normal verbose output (default) | — |
| `lite` | Drop filler and pleasantries, keep grammar | ~20% |
| `full` | Fragments, flat bullets, 50% word budget enforced | ~50-60% |
| `ultra` | Telegraphic, abbreviations, symbols | ~60-70% |

```json
{
  "mcpServers": {
    "the-council": {
      "command": "npx",
      "args": ["-y", "council-mcp"],
      "env": {
        "PATH": "/path/to/claude/bin:/usr/local/bin:/usr/bin:/bin",
        "COUNCIL_PERSIST": "sqlite",
        "COUNCIL_CAVEMAN": "full"
      }
    }
  }
}
```

`full` is the recommended setting — it hits the target savings without sacrificing readability of intermediate agent outputs. The active mode is recorded in each session's `metrics.caveman_mode` field, visible via `get_council_state`.

### Supervisor evaluation loop (optional)

The Supervisor reviews every Executor and Aide output. When `approved: false`, the orchestrator re-invokes the agent with the Supervisor's flags and recommendation appended as feedback, giving the agent a chance to address the issues before the result surfaces. If the retry budget is exhausted, the flagged result surfaces anyway — no output is silently dropped.

Configure with `COUNCIL_EVAL_RETRIES` (number of *additional* attempts after the initial one):

| Value | Behaviour | Worst-case agent calls per step |
|---|---|---|
| `0` | Supervisor is advisory only — matches pre-0.5 behaviour | 1 |
| `2` (default) | Up to 2 retries per flagged step — recommended | 3 |
| `5` | Hard ceiling — clamped at 5 | 6 |

Values outside `[0, 5]` are clamped; non-integer values fall back to the default. Each retry spends tokens for both the re-invoked agent *and* the Supervisor re-review, so high values trade quality for cost. The retry count for a session is recorded in `metrics.eval_retries`, visible via `get_council_state`.

```json
{
  "mcpServers": {
    "the-council": {
      "command": "npx",
      "args": ["-y", "council-mcp"],
      "env": {
        "PATH": "/path/to/claude/bin:/usr/local/bin:/usr/bin:/bin",
        "COUNCIL_PERSIST": "sqlite",
        "COUNCIL_EVAL_RETRIES": "2"
      }
    }
  }
}
```

### Registries

The package is published to two registries on every release:

| Registry | Package |
|---|---|
| [npm](https://www.npmjs.com/package/council-mcp) | `council-mcp` |
| [GitHub Packages](https://github.com/iamvirul/the-council/pkgs/npm/council-mcp) | `@iamvirul/council-mcp` |

---

## Usage Examples

### Trivial - formatting

> "Use The Council to format this JSON into a clean, human-readable structure."

Routes to the **Aide** (Haiku 4.5), then the **Supervisor** reviews the output. Fast and cheap.

### Complex - architecture design

> "Use The Council to design a microservices architecture for my e-commerce app."

Routes to the **Chancellor** (Opus 4.6) for analysis and planning. Each plan step runs through the **Executor** (Sonnet 4.6), which delegates simple sub-tasks to the **Aide**. The **Supervisor** reviews each Executor step and Aide task before results are aggregated.

### Review supervisor flags

> After running `orchestrate`, call `get_supervisor_verdicts` with the session ID.

```json
{ "session_id": "<uuid>", "flagged_only": true }
```

Returns only the outputs the Supervisor flagged, with specific issues and recommendations.

### Direct consultation - risk analysis

> "Consult the Chancellor about the risks in migrating our API from REST to GraphQL."

Calls `consult_chancellor` directly, skipping orchestration. Returns a structured `ChancellorResponse` with `analysis`, `risks[]`, `assumptions[]`, `success_metrics[]`, and `recommendations[]`.

---

## Session Lifecycle

<img width="1073" height="1392" alt="SessionLifecycle" src="https://github.com/user-attachments/assets/60a39141-682a-4e9c-9ac1-87837d282e90" />

Use `get_council_state` at any point to inspect a session. Each session tracks:
- Phase (`planning` / `executing` / `complete` / `failed`)
- Chancellor plan (if invoked)
- Executor step results
- Aide task results
- Supervisor verdicts (one per Executor step and Aide task)
- Metrics: total agent calls, agents invoked, duration, caveman mode, eval retries

---

## Development

```bash
git clone https://github.com/iamvirul/the-council.git
cd the-council

npm install

npm run dev         # run with tsx, no compile step
npm run build       # compile TypeScript to dist/
npm run type-check  # TypeScript check only
npm test            # run tests with vitest
npm run test:watch  # vitest watch mode
```

### Project structure

```
src/
  domain/           # Pure types, constants, error classes - no I/O
    models/         # types.ts, schemas.ts - response shapes and Zod validators
    constants/      # index.ts - model IDs, MAX_TURNS, system prompts
  application/      # Agent invocation and orchestration logic
    orchestrator/   # Complexity assessment + full orchestration flow
    chancellor/     # Chancellor agent wrapper
    executor/       # Executor agent wrapper
    aide/           # Aide agent wrapper
    supervisor/     # Supervisor agent wrapper (active quality gate with eval loop)
  infra/            # External dependencies
    agent-sdk/      # runner.ts (subprocess), parse.ts (JSON extractor), run-with-validation.ts (retry wrapper)
    config/         # caveman.ts (token compression), eval.ts (Supervisor retry budget)
    state/          # Session store: memory / file / SQLite backends
    logging/        # pino structured logger (stderr only)
  mcp/
    server/         # MCP server setup, tool registration, lifecycle
    tools/          # Zod schemas for all tool inputs
tests/
  unit/             # Fast isolated tests: config, schemas, stores, agent invokers, orchestrator
  integration/      # Real filesystem tests for FileStore and SQLiteStore
```

---

## Release

1. Bump version in `package.json`.
2. Update `CHANGELOG.md` - move Unreleased entries under the new version heading.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`
4. GitHub Actions builds, creates a GitHub Release, and publishes to npm and GitHub Packages.

To enable npm publishing, add your `NPM_TOKEN` as a repository secret under **Settings -> Secrets and variables -> Actions**.

---

## License

MIT - see [LICENSE](LICENSE).