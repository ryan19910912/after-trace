param(
    [switch]$SkipInstall,
    [switch]$SkipWorker,
    [switch]$SkipPages,
    [switch]$AllowDirty,
    [switch]$AllowNonMain
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = $PSScriptRoot
$WorkerUrl = 'https://after-trace-api.a0955625660.workers.dev'
$PagesUrl = 'https://after-trace.pages.dev'
$PagesProject = 'after-trace'
$LiffId = '2011322889-AU0teTPM'

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-CommandChecked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    Write-Step $Name
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

Push-Location $RepoRoot
try {
    Write-Host 'AFTERTRACE production deployment' -ForegroundColor Green
    Write-Host "Repository: $RepoRoot"

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

    # Vite variables are build-time values. Set them before the workspace build so
    # the manually uploaded Pages bundle points at production LINE/Worker endpoints.
    $env:VITE_LIFF_ID = $LiffId
    $env:VITE_API_BASE_URL = $WorkerUrl

    Invoke-CommandChecked 'TypeScript typecheck' {
        pnpm typecheck
    }

    Invoke-CommandChecked 'ESLint' {
        pnpm lint
    }

    Invoke-CommandChecked 'Tests' {
        pnpm test
    }

    Invoke-CommandChecked 'Production build' {
        pnpm build
    }

    Invoke-CommandChecked 'Drizzle schema check' {
        pnpm db:schema:check
    }

    if (-not $SkipWorker) {
        Invoke-CommandChecked 'Deploy Cloudflare Worker' {
            pnpm --filter @aftertrace/api exec wrangler deploy
        }

        Write-Step 'Verify Worker health'
        $health = Invoke-RestMethod "$WorkerUrl/health" -Method Get
        if ($health.status -ne 'ok') {
            throw "Worker health check failed: $($health | ConvertTo-Json -Compress)"
        }
        Write-Host "Worker health: $($health.status)" -ForegroundColor Green
    }

    if (-not $SkipPages) {
        Invoke-CommandChecked 'Deploy Cloudflare Pages' {
            # pnpm --filter executes from apps/api, so ../web/dist resolves to apps/web/dist.
            pnpm --filter @aftertrace/api exec wrangler pages deploy ../web/dist --project-name=$PagesProject --branch=main
        }

        Write-Step 'Verify Pages'
        $pagesResponse = Invoke-WebRequest $PagesUrl -Method Get
        if ($pagesResponse.StatusCode -lt 200 -or $pagesResponse.StatusCode -ge 400) {
            throw "Pages check failed with HTTP $($pagesResponse.StatusCode)"
        }
        Write-Host "Pages HTTP: $($pagesResponse.StatusCode)" -ForegroundColor Green
    }

    Write-Host ''
    Write-Host 'Deployment completed successfully.' -ForegroundColor Green
    Write-Host "Worker: $WorkerUrl"
    Write-Host "Pages : $PagesUrl"
    Write-Host "LIFF  : https://liff.line.me/$LiffId"
    Write-Host ''
    Write-Host 'Recommended smoke tests:' -ForegroundColor Yellow
    Write-Host '  1. LINE group: @AFTERTRACE 幫助'
    Write-Host '  2. LINE group: @AFTERTRACE 額度'
    Write-Host '  3. Open LIFF Energy / Memory pages'
}
finally {
    Pop-Location
}
