param(
    [string]$WorkerUrl = 'https://after-trace-api.a0955625660.workers.dev',
    [string]$PagesUrl = 'https://after-trace.pages.dev',
    [switch]$SkipPages,
    [switch]$RequireSourceData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Normalize-BaseUrl {
    param([Parameter(Mandatory = $true)][string]$Url)
    return $Url.Trim().TrimEnd('/')
}

function Invoke-JsonGet {
    param([Parameter(Mandatory = $true)][string]$Url)
    return Invoke-RestMethod $Url -Method Get
}

$WorkerUrl = Normalize-BaseUrl $WorkerUrl
$PagesUrl = Normalize-BaseUrl $PagesUrl

$health = Invoke-JsonGet "$WorkerUrl/health"
if ($health.status -ne 'ok') {
    throw "Worker liveness failed: status=$($health.status)"
}

$ready = Invoke-JsonGet "$WorkerUrl/ready"
if ($ready.status -ne 'ready') {
    throw "Worker readiness failed: status=$($ready.status)"
}
if ($ready.checks.database.status -ne 'ok') {
    throw "Worker readiness database check failed: $($ready.checks.database.status)"
}
if ($ready.checks.webPush.status -ne 'ok') {
    throw "Worker readiness Web Push check failed: $($ready.checks.webPush.status)"
}

$push = Invoke-JsonGet "$WorkerUrl/api/v1/push/config"
if (-not $push.configured -or -not $push.applicationServerKey) {
    throw 'Public Web Push configuration is not available.'
}

$sports = Invoke-JsonGet "$WorkerUrl/api/v1/sports"
if (-not $sports.ok) {
    throw 'Sports API did not return ok=true.'
}

$sourceDataVerified = $false
if ($sports.sports.Count -gt 0) {
    $sportCode = [uri]::EscapeDataString([string]$sports.sports[0].code)
    $venues = Invoke-JsonGet "$WorkerUrl/api/v1/venues?sport=$sportCode"
    if (-not $venues.ok) {
        throw 'Venues API did not return ok=true.'
    }

    $availability = Invoke-JsonGet "$WorkerUrl/api/v1/availability?sport=$sportCode&limit=1"
    if (-not $availability.ok) {
        throw 'Availability API did not return ok=true.'
    }
    $sourceDataVerified = $true
}
elseif ($RequireSourceData) {
    throw 'No synchronized sports exist yet. Wait for/trigger source polling before using -RequireSourceData.'
}

if (-not $SkipPages) {
    $response = Invoke-WebRequest $PagesUrl -Method Get -UseBasicParsing
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
        throw "Pages check failed with HTTP $($response.StatusCode)"
    }
}

Write-Host "`nAFTERTRACE smoke checks passed." -ForegroundColor Green
Write-Host "Worker: $WorkerUrl"
Write-Host "Readiness: database=ok, webPush=ok"
Write-Host "Source API data verified: $sourceDataVerified"
if (-not $SkipPages) { Write-Host "Pages: $PagesUrl" }
