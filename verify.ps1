$ErrorActionPreference = 'Stop'

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Host "`n==> $Name" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

try {
  Invoke-Step 'Git pull' { git pull --ff-only }
  Invoke-Step 'Typecheck' { pnpm typecheck }
  Invoke-Step 'Lint' { pnpm lint }
  Invoke-Step 'Test' { pnpm test }
  Invoke-Step 'Build' { pnpm build }
  Invoke-Step 'Drizzle schema' { pnpm db:schema:check }

  Write-Host "`nAll verification steps passed." -ForegroundColor Green
}
catch {
  Write-Host "`nVerification failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
