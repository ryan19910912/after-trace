param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('dev', 'prod')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ScriptDir '..')
$Dist = Join-Path $Root "dist-$Mode"
$Zip = Join-Path $Root "aftertrace-extension-$Mode.zip"

Push-Location $Root
try {
  pnpm run "build:$Mode"
  if (Test-Path $Zip) { Remove-Item $Zip -Force }
  Compress-Archive -Path (Join-Path $Dist '*') -DestinationPath $Zip -CompressionLevel Optimal
  Write-Host "Created $Zip"
} finally {
  Pop-Location
}
