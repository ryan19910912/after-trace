param(
    [switch]$SkipInstall,
    [switch]$AllowDirty,
    [switch]$AllowNonMain,
    [string]$WorkerUrl = 'https://after-trace-api.a0955625660.workers.dev',
    [string]$PagesUrl = 'https://after-trace.pages.dev',
    [string]$PagesProject = 'after-trace'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot
$WranglerCmd = Join-Path $RepoRoot 'apps\api\node_modules\.bin\wrangler.cmd'
$PagesDist = Join-Path $RepoRoot 'apps\web\dist'
$SmokeScript = Join-Path $RepoRoot 'smoke.ps1'

function Invoke-CommandChecked {
    param([string]$Name, [scriptblock]$Command)
    Write-Host "`n==> $Name" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

Push-Location $RepoRoot
try {
    Invoke-CommandChecked 'Check Git branch' {
        $branch = (git branch --show-current).Trim()
        if (-not $AllowNonMain -and $branch -ne 'main') { throw "Production deployment must run from main. Current branch: $branch" }
    }
    Invoke-CommandChecked 'Check working tree' {
        $status = git status --porcelain
        if (-not $AllowDirty -and $status) { throw 'Working tree is not clean.' }
    }
    Invoke-CommandChecked 'Update main' { git pull --ff-only }
    if (-not $SkipInstall) { Invoke-CommandChecked 'Install dependencies' { pnpm install --frozen-lockfile } }

    $env:VITE_API_BASE_URL = $WorkerUrl.TrimEnd('/')
    Invoke-CommandChecked 'Web typecheck' { pnpm --filter @aftertrace/web typecheck }
    Invoke-CommandChecked 'Web lint' { pnpm --filter @aftertrace/web lint }
    Invoke-CommandChecked 'Web tests' { pnpm --filter @aftertrace/web test }
    Invoke-CommandChecked 'Web build' { pnpm --filter @aftertrace/web build }
    Invoke-CommandChecked 'Deploy Cloudflare Pages' {
        if (-not (Test-Path $WranglerCmd)) { throw "Wrangler executable not found: $WranglerCmd" }
        & $WranglerCmd pages deploy $PagesDist --project-name=$PagesProject --branch=main
    }
    Invoke-CommandChecked 'Deployed Worker + Pages smoke' {
        if (-not (Test-Path $SmokeScript)) { throw "Smoke script not found: $SmokeScript" }
        & $SmokeScript -WorkerUrl $WorkerUrl -PagesUrl $PagesUrl
    }

    Write-Host "`nPages deployment completed and passed Worker readiness + Pages smoke checks." -ForegroundColor Green
}
finally {
    Pop-Location
}
