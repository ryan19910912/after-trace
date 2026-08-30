param(
    [switch]$SkipInstall,
    [switch]$AllowDirty,
    [switch]$AllowNonMain
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot
$WorkerUrl = 'https://after-trace-api.a0955625660.workers.dev'

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

    $health = Invoke-RestMethod "$WorkerUrl/health" -Method Get
    if ($health.status -ne 'ok') { throw 'Worker health check failed.' }
    $sports = Invoke-RestMethod "$WorkerUrl/api/v1/sports" -Method Get
    Write-Host "`nWorker deployment completed. Health: $($health.status); sports: $($sports.sports.Count)" -ForegroundColor Green
}
finally {
    Pop-Location
}
