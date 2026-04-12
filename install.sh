#!/usr/bin/env bash
set -euo pipefail

# ─── The Council — installer ─────────────────────────────────────────────────
# Adds council-mcp to your Claude MCP configuration.
# Run with: curl -fsSL https://raw.githubusercontent.com/iamvirul/the-council/main/install.sh | bash

PACKAGE="council-mcp"
SERVER_KEY="the-council"

# ─── Helpers ─────────────────────────────────────────────────────────────────

red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[0;34m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

die() { red "error: $*" >&2; exit 1; }

# ─── Node.js check ───────────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  die "Node.js is not installed. Install Node.js 22+ from https://nodejs.org and re-run this script."
fi

NODE_VERSION=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 22 ]; then
  die "Node.js 22+ is required (found $NODE_VERSION). Upgrade at https://nodejs.org"
fi

if ! command -v npx &>/dev/null; then
  die "npx is not available. Make sure npm is installed alongside Node.js."
fi

# ─── Find claude binary ───────────────────────────────────────────────────────
# council-mcp spawns sub-agents via the claude CLI — the same one Claude Code
# uses. No separate API key is needed; it runs under your existing session.

CLAUDE_PATH=""

# Common install locations
for candidate in \
  "$HOME/.local/bin/claude" \
  "/usr/local/bin/claude" \
  "/opt/homebrew/bin/claude" \
  "$HOME/.npm-global/bin/claude"; do
  if [ -x "$candidate" ]; then
    CLAUDE_PATH="$candidate"
    break
  fi
done

# Fallback: try PATH
if [ -z "$CLAUDE_PATH" ] && command -v claude &>/dev/null; then
  CLAUDE_PATH="$(command -v claude)"
fi

if [ -z "$CLAUDE_PATH" ]; then
  die "Claude Code CLI not found. Make sure Claude Code is installed and 'claude' is accessible."
fi

CLAUDE_DIR="$(dirname "$CLAUDE_PATH")"
echo "Found claude CLI at: $CLAUDE_PATH"

# ─── Authentication mode ──────────────────────────────────────────────────────
# Prefer using the existing Claude Code session via the CLI (no extra cost).
# Fall back to ANTHROPIC_API_KEY if explicitly set.

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  AUTH_MODE="api_key"
  echo "ANTHROPIC_API_KEY found in environment — will use API key auth."
else
  AUTH_MODE="session"
  echo "Using existing Claude Code session via CLI (no API key needed)."
fi

# ─── Find Claude config file (Desktop) ───────────────────────────────────────

case "$(uname -s)" in
  Darwin)
    DESKTOP_CONFIG_DIR="$HOME/Library/Application Support/Claude"
    ;;
  Linux)
    DESKTOP_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/Claude"
    ;;
  *)
    die "Unsupported OS. On Windows, use install.ps1 instead: irm https://raw.githubusercontent.com/iamvirul/the-council/main/install.ps1 | iex"
    ;;
esac

DESKTOP_CONFIG_FILE="$DESKTOP_CONFIG_DIR/claude_desktop_config.json"

# Build PATH string for env block
SYSTEM_PATH="/usr/local/bin:/usr/bin:/bin"
MCP_PATH="$CLAUDE_DIR:$SYSTEM_PATH"

# ─── 1. Claude Desktop config ────────────────────────────────────────────────

blue "Configuring Claude Desktop MCP server..."

node - "$DESKTOP_CONFIG_FILE" "$SERVER_KEY" "$PACKAGE" "$AUTH_MODE" "${ANTHROPIC_API_KEY:-}" "$MCP_PATH" <<'EOF'
const fs   = require('fs');
const path = require('path');

const [,, configFile, serverKey, pkg, authMode, apiKey, mcpPath] = process.argv;
const dir = path.dirname(configFile);

let config = {};
if (fs.existsSync(configFile)) {
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch {
    console.error('Warning: existing config is not valid JSON — creating a backup and starting fresh.');
    fs.copyFileSync(configFile, configFile + '.backup');
    config = {};
  }
}

config.mcpServers = config.mcpServers ?? {};

const env = authMode === 'api_key'
  ? { ANTHROPIC_API_KEY: apiKey }
  : { PATH: mcpPath };

config.mcpServers[serverKey] = { command: 'npx', args: ['-y', pkg], env };

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
console.log('  Desktop config : ' + configFile);
EOF

# ─── 2. Claude Code CLI config ───────────────────────────────────────────────

blue "Configuring Claude Code CLI MCP server..."

CLI_REGISTERED=false

if command -v claude &>/dev/null || [ -x "$CLAUDE_PATH" ]; then
  CLAUDE_CMD="${CLAUDE_PATH:-claude}"

  # Build the mcp add command with env
  if [ "$AUTH_MODE" = "api_key" ]; then
    "$CLAUDE_CMD" mcp add "$SERVER_KEY" \
      -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
      -- npx -y "$PACKAGE" 2>/dev/null && CLI_REGISTERED=true || true
  else
    "$CLAUDE_CMD" mcp add "$SERVER_KEY" \
      -e PATH="$MCP_PATH" \
      -- npx -y "$PACKAGE" 2>/dev/null && CLI_REGISTERED=true || true
  fi

  if [ "$CLI_REGISTERED" = true ]; then
    echo "  CLI config     : registered via 'claude mcp add'"
  else
    echo "  CLI config     : skipped (already registered or claude mcp add failed)"
  fi
else
  echo "  CLI config     : skipped (claude CLI not in PATH)"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
bold "The Council is configured."
echo ""
echo "  Server key : $SERVER_KEY"
echo "  Package    : $PACKAGE (runs via npx, no global install needed)"
echo "  Auth       : $AUTH_MODE"
echo ""
green "Restart Claude Code and the council tools will appear automatically."
echo ""
echo "Available tools after restart:"
echo "  orchestrate               route any problem through the full agent hierarchy"
echo "  consult_chancellor        invoke Opus directly for deep planning"
echo "  execute_with_executor     invoke Sonnet directly for implementation"
echo "  delegate_to_aide          invoke Haiku directly for simple tasks"
echo "  get_council_state         inspect session state"
echo "  get_supervisor_verdicts   review Supervisor quality flags for a session"
