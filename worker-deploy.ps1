param(
    [switch]$SkipInstall,
    [switch]$AllowDirty,
    [switch]$AllowNonMain,
    [string]$WorkerUrl = $env:AFTERTRACE_API_URL
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = $PSScriptRoot

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
    Write-Host 'AFTERTRACE API Worker production deployment' -ForegroundColor Green

    if (-not $WorkerUrl) {
        throw 'AFTERTRACE_API_URL (or -WorkerUrl) is required. Do not hard-code a workers.dev account subdomain in the repository.'
    }
    $parsedWorkerUrl = $null
    if (-not [Uri]::TryCreate($WorkerUrl, [UriKind]::Absolute, [ref]$parsedWorkerUrl) -or $parsedWorkerUrl.Scheme -ne 'https') {
        throw "Invalid AFTERTRACE API Worker URL: $WorkerUrl"
    }
    $WorkerUrl = $WorkerUrl.TrimEnd('/')

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

    Invoke-CommandChecked 'API Worker production build / dry-run' {
        pnpm --filter @aftertrace/api build
    }

    Invoke-CommandChecked 'Reject stale Worklog migration baseline' {
        pnpm db:baseline:guard
    }

    Invoke-CommandChecked 'Drizzle schema check' {
        pnpm db:schema:check
    }

    Invoke-CommandChecked 'Apply production DB migrations' {
        pnpm --filter @aftertrace/api db:deploy:migrate
    }

    Invoke-CommandChecked 'Deploy aftertrace-api Worker' {
        pnpm --filter @aftertrace/api exec wrangler deploy
    }

    Write-Step 'Verify API Worker health'
    $health = Invoke-RestMethod "$WorkerUrl/health" -Method Get
    if ($health.status -ne 'ok') {
        throw "Worker health check failed: $($health | ConvertTo-Json -Compress)"
    }
    Write-Host "API Worker health: $($health.status)" -ForegroundColor Green

    Write-Host ''
    Write-Host 'API Worker deployment completed successfully.' -ForegroundColor Green
    Write-Host "API: $WorkerUrl"
    Write-Host ''
    Write-Host 'Web and Admin deploy independently via web-worker-deploy.ps1 and admin-worker-deploy.ps1.' -ForegroundColor Yellow
}
finally {
    Pop-Location
}
