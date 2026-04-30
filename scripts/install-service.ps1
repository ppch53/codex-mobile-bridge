#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs Codex Mobile Bridge as a Windows service.
.DESCRIPTION
    Registers codex-mobile-bridge.exe as a Windows service with automatic restart.
    Creates .env from .env.example if missing.
#>

$ErrorActionPreference = 'Stop'
$ServiceName = 'CodexMobileBridge'
$ExePath = Join-Path $PSScriptRoot '..\dist\codex-mobile-bridge.exe'
$ExePath = [System.IO.Path]::GetFullPath($ExePath)

Write-Host 'Codex Mobile Bridge - Service Installer' -ForegroundColor Cyan

# Check exe exists
if (-not (Test-Path $ExePath)) {
    Write-Error "Executable not found: $ExePath`nRun 'npm run build && npm run package:windows' first."
    exit 1
}

# Check if service already exists
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Warning "Service '$ServiceName' already exists. Run uninstall-service.ps1 first."
    exit 1
}

# Create .env from example if missing
$EnvPath = Join-Path $PSScriptRoot '..\.env'
$EnvExample = Join-Path $PSScriptRoot '..\.env.example'
if (-not (Test-Path $EnvPath) -and (Test-Path $EnvExample)) {
    Copy-Item $EnvExample $EnvPath
    Write-Host '  Created .env from .env.example - edit it before starting the service.' -ForegroundColor Yellow
}

# Create the service
Write-Host '  Registering service...'
sc.exe create $ServiceName binPath= "`"$ExePath`"" start= auto DisplayName= 'Codex Mobile Bridge' | Out-Null

# Configure automatic restart on failure
sc.exe failure $ServiceName actions= restart/5000/restart/10000/restart/30000 reset= 86400 | Out-Null

# Start the service
Write-Host '  Starting service...'
Start-Service -Name $ServiceName
Start-Sleep -Seconds 2

$svc = Get-Service -Name $ServiceName
Write-Host ''
Write-Host "  Service: $($svc.Status)" -ForegroundColor Green
Write-Host "  Binary:  $ExePath"
Write-Host ''
Write-Host 'Service installed successfully.' -ForegroundColor Green
Write-Host 'Edit .env to configure Telegram token, allowed workspaces, etc.'
