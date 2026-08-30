param(
    [switch]$SkipInstall,
    [switch]$AllowDirty,
    [switch]$AllowNonMain
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = $PSScriptRoot
$WorkerUrl = 'https://after-trace-api.a0955625660.workers.dev'

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-CommandChecked {
    param(
        [Parameter(Mandatory = $true)] [string]$Name,
        [Parameter(Mandatory = $true)] [scriptblock]$Command
    )

    Write-Step $Name
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

Push-Location $RepoRoot
try {
    Write-Host 'AFTERTRACE Worker production deployment' -ForegroundColor Green

    Invoke-CommandChecked 'Check Git branch' {
        $branch = (git branch --show-current).Trim()
        if (-not $AllowNonMain -and $branch -ne 'main') {
            Write-Error "Production deployment must run from main. Current branch: $branch"
            exit 1
        }
        Write-Host "Branch: $branch"
    }

    Invoke-CommandChecked 'Check working tree' {
        $status = git status --porcelain
        if (-not $AllowDirty -and $status) {
            Write-Host $status
            Write-Error 'Working tree is not clean. Commit/stash changes first, or use -AllowDirty intentionally.'
            exit 1
        }
        Write-Host 'Working tree: clean'
    }

    Invoke-CommandChecked 'Update main from origin' {
        git pull --ff-only
    }

    if (-not $SkipInstall) {
        Invoke-CommandChecked 'Install dependencies from lockfile' {
            pnpm install --frozen-lockfile
        }
    }

    Invoke-CommandChecked 'TypeScript typecheck' {
        pnpm typecheck
    }

    Invoke-CommandChecked 'ESLint' {
        pnpm lint
    }

    Invoke-CommandChecked 'Tests' {
        pnpm test
    }

    Invoke-CommandChecked 'Worker production build / dry-run' {
        pnpm --filter @aftertrace/api build
    }

    Invoke-CommandChecked 'Drizzle schema check' {
        pnpm db:schema:check
    }

    Invoke-CommandChecked 'Deploy Cloudflare Worker' {
        pnpm --filter @aftertrace/api exec wrangler deploy
    }

    Write-Step 'Verify Worker health'
    $health = Invoke-RestMethod "$WorkerUrl/health" -Method Get
    if ($health.status -ne 'ok') {
        throw "Worker health check failed: $($health | ConvertTo-Json -Compress)"
    }
    Write-Host "Worker health: $($health.status)" -ForegroundColor Green

    Write-Host ''
    Write-Host 'Worker deployment completed successfully.' -ForegroundColor Green
    Write-Host "Worker: $WorkerUrl"
    Write-Host ''
    Write-Host 'Recommended smoke tests:' -ForegroundColor Yellow
    Write-Host '  1. LINE group: @AFTERTRACE 幫助'
    Write-Host '  2. LINE group: @AFTERTRACE 額度'
    Write-Host '  3. Open LIFF and verify Energy API'
}
finally {
    Pop-Location
}
