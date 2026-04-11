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

# ─── Find Claude config file ─────────────────────────────────────────────────

case "$(uname -s)" in
  Darwin)
    CONFIG_DIR="$HOME/Library/Application Support/Claude"
    ;;
  Linux)
    CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/Claude"
    ;;
  *)
    die "Unsupported OS. On Windows, run this script in WSL or Git Bash."
    ;;
esac

CONFIG_FILE="$CONFIG_DIR/claude_desktop_config.json"

# ─── Merge MCP server entry into config ──────────────────────────────────────

blue "Configuring Claude MCP server..."

node - "$CONFIG_FILE" "$SERVER_KEY" "$PACKAGE" <<'EOF'
const fs   = require('fs');
const path = require('path');

const [,, configFile, serverKey, pkg] = process.argv;
const dir = path.dirname(configFile);

// Read existing config or start empty
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

// Merge in the new server entry without touching anything else
config.mcpServers = config.mcpServers ?? {};

if (config.mcpServers[serverKey]) {
  console.log(`Already configured: "${serverKey}" entry exists — updating.`);
}

config.mcpServers[serverKey] = {
  command: 'npx',
  args: ['-y', pkg],
};

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
console.log('Config written to: ' + configFile);
EOF

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
bold "The Council is configured."
echo ""
echo "  Server key : $SERVER_KEY"
echo "  Package    : $PACKAGE (runs via npx, no global install needed)"
echo "  Config     : $CONFIG_FILE"
echo ""
green "Restart Claude Code and the council tools will appear automatically."
echo ""
echo "Available tools after restart:"
echo "  orchestrate            route any problem through the full agent hierarchy"
echo "  consult_chancellor     invoke Opus directly for deep planning"
echo "  execute_with_executor  invoke Sonnet directly for implementation"
echo "  delegate_to_aide       invoke Haiku directly for simple tasks"
echo "  get_council_state      inspect session state"
