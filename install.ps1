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

# ─── Find Claude config file ─────────────────────────────────────────────────

$ConfigDir  = Join-Path $env:APPDATA 'Claude'
$ConfigFile = Join-Path $ConfigDir 'claude_desktop_config.json'

# ─── Merge MCP server entry into config ──────────────────────────────────────

Write-Info "Configuring Claude MCP server..."

# Read existing config or start empty
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

# Ensure mcpServers key exists
if (-not $config.ContainsKey('mcpServers')) {
    $config['mcpServers'] = @{}
}

if ($config['mcpServers'].ContainsKey($ServerKey)) {
    Write-Host "Already configured: `"$ServerKey`" entry exists - updating." -ForegroundColor Yellow
}

# Set the server entry
$config['mcpServers'][$ServerKey] = [ordered]@{
    command = 'npx'
    args    = @('-y', $Package)
}

# Write back
if (-not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
}

$config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile -Encoding UTF8
Write-Host "Config written to: $ConfigFile"

# ─── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "The Council is configured." -ForegroundColor White -BackgroundColor DarkGreen
Write-Host ""
Write-Host "  Server key : $ServerKey"
Write-Host "  Package    : $Package (runs via npx, no global install needed)"
Write-Host "  Config     : $ConfigFile"
Write-Host ""
Write-Ok "Restart Claude Code and the council tools will appear automatically."
Write-Host ""
Write-Host "Available tools after restart:"
Write-Host "  orchestrate            route any problem through the full agent hierarchy"
Write-Host "  consult_chancellor     invoke Opus directly for deep planning"
Write-Host "  execute_with_executor  invoke Sonnet directly for implementation"
Write-Host "  delegate_to_aide       invoke Haiku directly for simple tasks"
Write-Host "  get_council_state      inspect session state"
