<#
.SYNOPSIS
    Start Codex Mobile Bridge in development mode
.DESCRIPTION
    Starts the bridge with stdio transport for local development.
#>

$env:CODEX_TRANSPORT = "stdio"
$env:CODEX_BINARY = "codex"
$env:NODE_ENV = "development"
$env:LOG_LEVEL = "debug"

Write-Host "Starting Codex Mobile Bridge (dev mode)..." -ForegroundColor Cyan
Write-Host "  Transport: stdio"
Write-Host "  Binary: codex"
Write-Host ""

npm run dev:bridge
