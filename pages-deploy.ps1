param(
    [switch]$SkipInstall,
    [switch]$AllowDirty,
    [switch]$AllowNonMain
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = $PSScriptRoot
$WorkerUrl = 'https://after-trace-api.a0955625660.workers.dev'
$PagesUrl = 'https://after-trace.pages.dev'
$PagesProject = 'after-trace'
$WranglerCmd = Join-Path $RepoRoot 'apps\api\node_modules\.bin\wrangler.cmd'
$PagesDist = Join-Path $RepoRoot 'apps\web\dist'

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
    Write-Host 'AFTERTRACE Pages production deployment' -ForegroundColor Green

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

    $env:VITE_API_BASE_URL = $WorkerUrl

    Invoke-CommandChecked 'Web TypeScript typecheck' {
        pnpm --filter @aftertrace/web typecheck
    }

    Invoke-CommandChecked 'Web ESLint' {
        pnpm --filter @aftertrace/web lint
    }

    Invoke-CommandChecked 'Web tests' {
        pnpm --filter @aftertrace/web test
    }

    Invoke-CommandChecked 'Web production build' {
        pnpm --filter @aftertrace/web build
    }

    Invoke-CommandChecked 'Deploy Cloudflare Pages' {
        if (-not (Test-Path $WranglerCmd)) {
            throw "Wrangler executable not found: $WranglerCmd"
        }
        & $WranglerCmd pages deploy $PagesDist --project-name=$PagesProject --branch=main
    }

    Write-Step 'Verify Pages'
    $response = Invoke-WebRequest $PagesUrl -Method Get -UseBasicParsing
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
        throw "Pages check failed with HTTP $($response.StatusCode)"
    }
    Write-Host "Pages HTTP: $($response.StatusCode)" -ForegroundColor Green

    Write-Host ''
    Write-Host 'Pages deployment completed successfully.' -ForegroundColor Green
    Write-Host "Pages: $PagesUrl"
    Write-Host ''
    Write-Host 'Recommended smoke tests:' -ForegroundColor Yellow
    Write-Host '  1. Open Pages directly and verify LINE Login -> My Groups'
    Write-Host '  2. Open a fresh Bot management link and verify it enters the correct group without another login'
    Write-Host '  3. Verify Memory / Energy / Reminder tabs load'
    Write-Host '  4. Reopen the same Bot login link and verify the one-time ticket is rejected'
}
finally {
    Pop-Location
}
