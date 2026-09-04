param(
    [switch]$SkipInstall,
    [switch]$AllowDirty,
    [switch]$AllowNonMain,
    [string]$ApiOrigin = $env:AFTERTRACE_API_URL,
    [string]$ExpectedUrl = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = $PSScriptRoot
$WranglerCmd = Join-Path $RepoRoot 'apps\api\node_modules\.bin\wrangler.cmd'
$WranglerConfig = Join-Path $RepoRoot 'apps\web\wrangler.toml'

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

function Assert-HttpsOrigin([string]$Value, [string]$Name) {
    if (-not $Value.Trim()) {
        throw "$Name is required. Set AFTERTRACE_API_URL or pass -ApiOrigin explicitly."
    }
    $uri = [Uri]$Value
    if ($uri.Scheme -ne 'https' -or -not $uri.Host) {
        throw "$Name must be an absolute https URL"
    }
    return $uri.GetLeftPart([System.UriPartial]::Authority)
}

Push-Location $RepoRoot
try {
    Write-Host 'AFTERTRACE Web Worker production deployment' -ForegroundColor Green

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

    if (-not (Test-Path $WranglerCmd)) {
        throw "Wrangler executable not found: $WranglerCmd"
    }

    $env:VITE_API_BASE_URL = Assert-HttpsOrigin $ApiOrigin 'ApiOrigin'

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

    Invoke-CommandChecked 'Deploy aftertrace-web Worker' {
        & $WranglerCmd deploy --config $WranglerConfig
    }

    if ($ExpectedUrl.Trim()) {
        $url = Assert-HttpsOrigin $ExpectedUrl 'ExpectedUrl'
        Write-Step 'Verify Web Worker'
        $response = Invoke-WebRequest $url -Method Get -UseBasicParsing
        if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
            throw "Web Worker check failed with HTTP $($response.StatusCode)"
        }
        Write-Host "Web Worker HTTP: $($response.StatusCode)" -ForegroundColor Green
    }

    Write-Host ''
    Write-Host 'Web Worker deployment completed successfully.' -ForegroundColor Green
    Write-Host "API: $($env:VITE_API_BASE_URL)"
    if ($ExpectedUrl.Trim()) { Write-Host "Web: $ExpectedUrl" }
}
finally {
    Pop-Location
}
