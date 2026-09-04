param(
    [switch]$SkipInstall,
    [switch]$AllowDirty,
    [switch]$AllowNonMain,
    [switch]$AllowInitialBootstrapNotReady,
    [string]$WorkerUrl = $env:AFTERTRACE_API_URL,
    [string]$DatabaseUrl = $env:AFTERTRACE_PROD_DATABASE_URL
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

function Assert-PostgresUrl([string]$Value) {
    if (-not $Value.Trim()) {
        throw 'AFTERTRACE_PROD_DATABASE_URL (or -DatabaseUrl) is required for production migration. The deploy helper must never fall back to repository .env.local.'
    }
    $uri = $null
    if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri) -or ($uri.Scheme -ne 'postgresql' -and $uri.Scheme -ne 'postgres')) {
        throw 'Production DatabaseUrl must be an absolute postgresql:// or postgres:// URL.'
    }
    return $Value.Trim()
}

function Read-ReadinessError($Failure) {
    if ($null -eq $Failure -or $null -eq $Failure.ErrorDetails) { return $null }
    $message = $Failure.ErrorDetails.Message
    if (-not $message) { return $null }
    try {
        $parsed = $message | ConvertFrom-Json
        if ($null -eq $parsed -or -not $parsed.error) { return $null }
        return [string]$parsed.error
    }
    catch {
        return $null
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
    $DatabaseUrl = Assert-PostgresUrl $DatabaseUrl

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

    Invoke-CommandChecked 'Reject stale Worklog migration baseline' {
        node scripts/check-worklog-baseline.mjs
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

    Invoke-CommandChecked 'Drizzle schema check' {
        pnpm db:schema:check
    }

    # Production migration must use an explicitly supplied production DB URL. Never let
    # drizzle.config.ts silently fall back to local .env.local during a production deploy.
    $previousDatabaseUrl = $env:DATABASE_URL
    try {
        $env:DATABASE_URL = $DatabaseUrl
        Invoke-CommandChecked 'Apply production DB migrations' {
            pnpm --filter @aftertrace/api db:deploy:migrate
        }
    }
    finally {
        $env:DATABASE_URL = $previousDatabaseUrl
    }

    Invoke-CommandChecked 'Deploy aftertrace-api Worker' {
        pnpm --filter @aftertrace/api exec wrangler deploy
    }

    Write-Step 'Verify API Worker liveness'
    $health = Invoke-RestMethod "$WorkerUrl/health" -Method Get
    if ($health.status -ne 'ok') {
        throw "Worker liveness check failed: $($health | ConvertTo-Json -Compress)"
    }
    Write-Host "API Worker liveness: $($health.status)" -ForegroundColor Green

    Write-Step 'Verify API launch readiness'
    $bootstrapPending = $false
    try {
        $ready = Invoke-RestMethod "$WorkerUrl/health/ready" -Method Get
        if ($ready.status -ne 'ready') {
            throw "Worker readiness check failed: $($ready | ConvertTo-Json -Compress)"
        }
        Write-Host "API Worker readiness: $($ready.status)" -ForegroundColor Green
    }
    catch {
        $readinessError = Read-ReadinessError $_
        $allowedBootstrapError = $readinessError -eq 'AI_RUNTIME_CONFIG_NOT_INITIALIZED' -or $readinessError -eq 'FREE_PLAN_NOT_INITIALIZED'
        if ($AllowInitialBootstrapNotReady -and $allowedBootstrapError) {
            $bootstrapPending = $true
            Write-Warning "API Worker is live but first-database bootstrap is incomplete ($readinessError). Deploy Admin, initialize AI runtime + FREE plan, then require /health/ready=ready before public launch."
        }
        else {
            throw "Worker readiness check failed. Verify Worker vars/secrets, initialized FREE/AI runtime config, and the regenerated Worklog database schema. $($_.Exception.Message)"
        }
    }

    Write-Host ''
    if ($bootstrapPending) {
        Write-Host 'API Worker deployment completed in INITIAL BOOTSTRAP mode; public launch is NOT ready yet.' -ForegroundColor Yellow
    }
    else {
        Write-Host 'API Worker deployment completed successfully.' -ForegroundColor Green
    }
    Write-Host "API: $WorkerUrl"
    Write-Host ''
    Write-Host 'Web and Admin deploy independently via web-worker-deploy.ps1 and admin-worker-deploy.ps1.' -ForegroundColor Yellow
}
finally {
    Pop-Location
}
