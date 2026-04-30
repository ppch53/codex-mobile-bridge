<#
.SYNOPSIS
    Scan source code for potential secrets
.DESCRIPTION
    Searches TypeScript and JSON files for patterns that look like API keys,
    tokens, passwords, and other sensitive data.
#>

$patterns = @(
    "sk-[a-zA-Z0-9]{20,}",
    "ghp_[a-zA-Z0-9]{36}",
    "xoxb-[a-zA-Z0-9-]+",
    "Bearer [A-Za-z0-9._-]{20,}",
    "api_key\s*=\s*[A-Za-z0-9._-]{10,}",
    "password\s*=\s*[^\s&]{8,}",
    "secret\s*=\s*[^\s&]{8,}"
)

$excludeDirs = @("node_modules", "dist", ".git")
$found = $false

Write-Host "Scanning for potential secrets..." -ForegroundColor Cyan
Write-Host ""

foreach ($pattern in $patterns) {
    $files = Get-ChildItem -Recurse -Include *.ts,*.json,*.js -ErrorAction SilentlyContinue |
        Where-Object {
            $excluded = $false
            foreach ($dir in $excludeDirs) {
                if ($_.FullName -like "*\$dir\*") { $excluded = $true; break }
            }
            -not $excluded -and $_.Name -ne ".env.example"
        }

    foreach ($file in $files) {
        $matches = Select-String -Path $file.FullName -Pattern $pattern -ErrorAction SilentlyContinue
        if ($matches) {
            foreach ($match in $matches) {
                Write-Host "  FOUND: $($file.FullName):$($match.LineNumber)" -ForegroundColor Red
                Write-Host "    $($match.Line.Trim())" -ForegroundColor DarkRed
                $found = $true
            }
        }
    }
}

Write-Host ""
if ($found) {
    Write-Host "WARNING: Potential secrets found. Review the matches above." -ForegroundColor Red
    exit 1
} else {
    Write-Host "No potential secrets found." -ForegroundColor Green
    exit 0
}
