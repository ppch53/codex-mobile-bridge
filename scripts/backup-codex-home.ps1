<#
.SYNOPSIS
    Backup Codex home directory
.DESCRIPTION
    Creates a timestamped backup of the Codex home directory.
.PARAMETER OutputDir
    Directory to store the backup (default: USERPROFILE)
#>
param(
    [string]$OutputDir = $env:USERPROFILE
)

$codexHome = "$env:USERPROFILE\.codex"

if (-not (Test-Path $codexHome)) {
    Write-Error "Codex home not found at $codexHome"
    exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupName = ".codex.backup.$timestamp"
$backupPath = Join-Path $OutputDir $backupName

Write-Host "Backing up $codexHome to $backupPath ..."

Copy-Item $codexHome $backupPath -Recurse

Write-Host "Backup created at $backupPath" -ForegroundColor Green
Write-Host "NOTE: Backup does NOT contain auth.json contents for security." -ForegroundColor Yellow
