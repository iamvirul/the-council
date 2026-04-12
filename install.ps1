# The Council - Windows installer
# Run with: irm https://raw.githubusercontent.com/iamvirul/the-council/main/install.ps1 | iex

$ErrorActionPreference = 'Stop'

$Package   = 'council-mcp'
$ServerKey = 'the-council'

# ─── Helpers ─────────────────────────────────────────────────────────────────

function Write-Info  { param($msg) Write-Host $msg -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host $msg -ForegroundColor Green }
function Write-Fail  { param($msg) Write-Host "error: $msg" -ForegroundColor Red; exit 1 }

# ─── Node.js check ───────────────────────────────────────────────────────────

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail "Node.js is not installed. Install Node.js 22+ from https://nodejs.org and re-run this script."
}

$nodeVersion = (node -e "process.stdout.write(process.versions.node)")
$nodeMajor   = [int]($nodeVersion -split '\.')[0]

if ($nodeMajor -lt 22) {
    Write-Fail "Node.js 22+ is required (found $nodeVersion). Upgrade at https://nodejs.org"
}

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Fail "npx is not available. Make sure npm is installed alongside Node.js."
}

# ─── Find claude binary ───────────────────────────────────────────────────────
# council-mcp spawns sub-agents via the claude CLI — no separate API key needed
# if Claude Code is already installed.

$ClaudePath = $null

$candidates = @(
    "$env:LOCALAPPDATA\Programs\claude\claude.exe",
    "$env:LOCALAPPDATA\AnthropicClaude\claude.exe",
    (Get-Command claude -ErrorAction SilentlyContinue)?.Source
)

foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) {
        $ClaudePath = $c
        break
    }
}

$AuthMode = 'session'
$ApiKey   = $env:ANTHROPIC_API_KEY

if ($ClaudePath) {
    Write-Host "Found claude CLI at: $ClaudePath"
    Write-Host "Using existing Claude Code session (no API key needed)."
} elseif ($ApiKey) {
    $AuthMode = 'api_key'
    Write-Host "claude CLI not found — using ANTHROPIC_API_KEY."
} else {
    Write-Host "claude CLI not found in common locations." -ForegroundColor Yellow
    Write-Host "If Claude Code is installed, add its directory to PATH and re-run."
    Write-Host "Or set ANTHROPIC_API_KEY to use API key auth instead."
    $SecureKey = Read-Host "Paste your Anthropic API key (or press Enter to skip)" -AsSecureString
    $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
    )
    if ($ApiKey) {
        $AuthMode = 'api_key'
    } else {
        Write-Fail "No claude CLI or API key available. Cannot configure The Council."
    }
}

$ClaudeDir = if ($ClaudePath) { Split-Path $ClaudePath } else { $null }
$McpPath   = if ($ClaudeDir) { "$ClaudeDir;$env:SystemRoot\System32" } else { $null }

# ─── 1. Claude Desktop config ────────────────────────────────────────────────

$ConfigDir  = Join-Path $env:APPDATA 'Claude'
$ConfigFile = Join-Path $ConfigDir 'claude_desktop_config.json'

Write-Info "Configuring Claude Desktop MCP server..."

if (Test-Path $ConfigFile) {
    try {
        $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json -AsHashtable
    } catch {
        Write-Host "Warning: existing config is not valid JSON - creating a backup and starting fresh." -ForegroundColor Yellow
        Copy-Item $ConfigFile "$ConfigFile.backup"
        $config = @{}
    }
} else {
    $config = @{}
}

if (-not $config.ContainsKey('mcpServers')) {
    $config['mcpServers'] = @{}
}

$env_block = if ($AuthMode -eq 'api_key') {
    [ordered]@{ ANTHROPIC_API_KEY = $ApiKey }
} else {
    [ordered]@{ PATH = $McpPath }
}

$config['mcpServers'][$ServerKey] = [ordered]@{
    command = 'npx'
    args    = @('-y', $Package)
    env     = $env_block
}

if (-not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
}

$config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile -Encoding UTF8
Write-Host "  Desktop config : $ConfigFile"

# ─── 2. Claude Code CLI config ───────────────────────────────────────────────

Write-Info "Configuring Claude Code CLI MCP server..."

$ClaudeCmd = if ($ClaudePath) { $ClaudePath } elseif (Get-Command claude -ErrorAction SilentlyContinue) { 'claude' } else { $null }

if ($ClaudeCmd) {
    try {
        if ($AuthMode -eq 'api_key') {
            & $ClaudeCmd mcp add $ServerKey -e "ANTHROPIC_API_KEY=$ApiKey" -- npx -y $Package 2>$null
        } else {
            & $ClaudeCmd mcp add $ServerKey -e "PATH=$McpPath" -- npx -y $Package 2>$null
        }
        Write-Host "  CLI config     : registered via 'claude mcp add'"
    } catch {
        Write-Host "  CLI config     : skipped (already registered or claude mcp add failed)"
    }
} else {
    Write-Host "  CLI config     : skipped (claude CLI not found)"
}

# ─── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "The Council is configured." -ForegroundColor White -BackgroundColor DarkGreen
Write-Host ""
Write-Host "  Server key : $ServerKey"
Write-Host "  Package    : $Package (runs via npx, no global install needed)"
Write-Host "  Auth       : $AuthMode"
Write-Host ""
Write-Ok "Restart Claude Code and the council tools will appear automatically."
Write-Host ""
Write-Host "Available tools after restart:"
Write-Host "  orchestrate               route any problem through the full agent hierarchy"
Write-Host "  consult_chancellor        invoke Opus directly for deep planning"
Write-Host "  execute_with_executor     invoke Sonnet directly for implementation"
Write-Host "  delegate_to_aide          invoke Haiku directly for simple tasks"
Write-Host "  get_council_state         inspect session state"
Write-Host "  get_supervisor_verdicts   review Supervisor quality flags for a session"
