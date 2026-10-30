param([switch]$Build)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$deploymentScript=Join-Path $PSScriptRoot 'local-deployment.mjs'
$deploymentFolder=Join-Path $projectRoot '.test-artifacts\local-deployment'
$nodeBinary=(Get-Command node).Source
if($Build){ Push-Location $projectRoot; try { & $nodeBinary $deploymentScript build; if($LASTEXITCODE -ne 0){throw 'Build failed'} } finally { Pop-Location } }
if(!(Test-Path (Join-Path $deploymentFolder 'manifest.json'))){throw 'Build production assets first'}
$processFile=Join-Path $deploymentFolder 'processes.json'
if(Test-Path $processFile){
  $recorded=Get-Content $processFile -Raw | ConvertFrom-Json
  $snapshot=@(Get-CimInstance Win32_Process)
  foreach($component in @('api','web','admin')){
    $processId=[int]$recorded.$component
    $rootProcess=$snapshot | Where-Object ProcessId -eq $processId
    if(!$rootProcess){continue}
    if($rootProcess.Name -ne 'node.exe' -or $rootProcess.CommandLine -notmatch ('local-deployment\.mjs[\x22]? '+$component+'\s*$')){throw "PID $processId no longer belongs to this deployment"}
    $tree=@($processId)
    for($level=0;$level -lt 8;$level++){ $children=@($snapshot|Where-Object{$_.ParentProcessId -in $tree -and $_.ProcessId -notin $tree}|Select-Object -ExpandProperty ProcessId);if(!$children.Count){break};$tree+=$children }
    Stop-Process -Id $processId -ErrorAction SilentlyContinue
    foreach($childId in $tree){Stop-Process -Id $childId -ErrorAction SilentlyContinue}
  }
}
$started=@{}
foreach($component in @('api','web','admin')){ $service=Start-Process -FilePath $nodeBinary -ArgumentList @($deploymentScript,$component) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $deploymentFolder ($component+'.log')) -RedirectStandardError (Join-Path $deploymentFolder ($component+'.error.log'));$started[$component]=$service.Id }
$started|ConvertTo-Json|Set-Content $processFile -Encoding utf8
$started|ConvertTo-Json
