param(
    [switch]$SkipInstall,
    [switch]$AllowDirty,
    [switch]$AllowNonMain,
    [string]$WorkerUrl = 'https://after-trace-api.a0955625660.workers.dev'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot
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
    Invoke-CommandChecked 'Typecheck' { pnpm typecheck }
    Invoke-CommandChecked 'Lint' { pnpm lint }
    Invoke-CommandChecked 'Tests' { pnpm test }
    Invoke-CommandChecked 'Worker dry-run' { pnpm --filter @aftertrace/api build }
    Invoke-CommandChecked 'Drizzle schema check' { pnpm db:schema:check }
    Invoke-CommandChecked 'Apply database migrations' { pnpm --filter @aftertrace/api db:deploy:migrate }
    Invoke-CommandChecked 'Deploy Worker' { pnpm --filter @aftertrace/api exec wrangler deploy }
    Invoke-CommandChecked 'Deployed Worker smoke' {
        if (-not (Test-Path $SmokeScript)) { throw "Smoke script not found: $SmokeScript" }
        & $SmokeScript -WorkerUrl $WorkerUrl -SkipPages
    }

    Write-Host "`nWorker deployment completed and passed liveness/readiness/API smoke checks." -ForegroundColor Green
}
finally {
    Pop-Location
}
