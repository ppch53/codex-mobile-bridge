#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Uninstalls the Codex Mobile Bridge Windows service.
.DESCRIPTION
    Stops and removes the service. User data in %APPDATA%\CodexMobileBridge is preserved.
#>

$ErrorActionPreference = 'Stop'
$ServiceName = 'CodexMobileBridge'

Write-Host 'Codex Mobile Bridge - Service Uninstaller' -ForegroundColor Cyan

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Warning "Service '$ServiceName' not found."
    exit 0
}

# Stop if running
if ($svc.Status -eq 'Running') {
    Write-Host '  Stopping service...'
    Stop-Service -Name $ServiceName -Force
    Start-Sleep -Seconds 2
}

# Remove
Write-Host '  Removing service...'
sc.exe delete $ServiceName | Out-Null

Write-Host ''
Write-Host 'Service removed.' -ForegroundColor Green
Write-Host 'User data preserved in %APPDATA%\CodexMobileBridge.'
