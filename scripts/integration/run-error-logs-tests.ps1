param()
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $projectRoot
$nodeBinary=(Get-Command node).Source
$wrangler=(Get-ChildItem node_modules/.pnpm -Directory -Filter 'wrangler@*'|Select-Object -First 1).FullName+'\node_modules\wrangler\bin\wrangler.js'
$owned=@()
function Stop-OwnedHarness($processId){
  $snapshot=@(Get-CimInstance Win32_Process)
  $rootProcess=$snapshot|Where-Object ProcessId -eq $processId
  if(!$rootProcess){return}
  if($rootProcess.Name -ne 'node.exe' -or $rootProcess.CommandLine -notmatch 'error-capture-187(89|90)\.json'){throw 'Harness PID identity changed'}
  $tree=@($processId)
  for($level=0;$level -lt 8;$level++){$children=@($snapshot|Where-Object{$_.ParentProcessId -in $tree -and $_.ProcessId -notin $tree}|Select-Object -ExpandProperty ProcessId);if(!$children.Count){break};$tree+=$children}
  foreach($childId in $tree){Stop-Process -Id $childId -ErrorAction SilentlyContinue}
}
$processFile='.test-artifacts/errors-harness-processes.json'
if(Test-Path $processFile){$prior=Get-Content $processFile -Raw|ConvertFrom-Json;foreach($port in @('18789','18790')){if($prior.$port){Stop-OwnedHarness ([int]$prior.$port)}}}
@"
import {withRequestDiagnostics} from '../apps/api/src/diagnostics/capture';export default {fetch(request,env,ctx){return withRequestDiagnostics(request,env,ctx,async()=>Response.json({error:'CONTROLLED_FAILURE',privateCanary:'DO_NOT_STORE_PRIVATE_CANARY'},{status:503}));}};
"@ | Set-Content -Encoding utf8 .test-artifacts/error-capture.worker.ts
try{
  $started=@{}
  foreach($port in @(18789,18790)){
    $cfg=Get-Content .test-artifacts/wrangler.integration.json -Raw|ConvertFrom-Json
    $cfg.main=(Join-Path $projectRoot '.test-artifacts/error-capture.worker.ts')
    $cfg.name="aftertrace-error-capture-$port"
    if($port -eq 18790){$cfg.vars.DATABASE_URL='postgresql://aftertrace:local@127.0.0.1:1/aftertrace?sslmode=disable'}
    $configPath=".test-artifacts/error-capture-$port.json"
    $cfg|ConvertTo-Json -Depth 30|Set-Content -Encoding utf8 $configPath
    $service=Start-Process $nodeBinary -ArgumentList @($wrangler,'dev','--local','--port',"$port",'--config',$configPath) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput ".test-artifacts/error-harness-$port.log" -RedirectStandardError ".test-artifacts/error-harness-$port.error.log"
    $owned+=$service.Id;$started["$port"]=$service.Id
  }
  $started|ConvertTo-Json|Set-Content -Encoding utf8 $processFile
  foreach($port in @(18789,18790)){
    $ready=$false
    for($attempt=0;$attempt -lt 30;$attempt++){
      $client=New-Object Net.Sockets.TcpClient
      try{$connection=$client.ConnectAsync('127.0.0.1',$port);if($connection.Wait(500) -and $client.Connected){$ready=$true;break}}catch{}finally{$client.Dispose()}
      Start-Sleep -Milliseconds 500
    }
    if(!$ready){throw "Harness $port failed to start"}
  }
  & $nodeBinary scripts/integration/error-logs-test.mjs
  if($LASTEXITCODE -ne 0){throw 'Error API integration failed'}
  & $nodeBinary scripts/integration/error-logs-ui-test.mjs
  if($LASTEXITCODE -ne 0){throw 'Error UI integration failed'}
}finally{foreach($processId in $owned){Stop-OwnedHarness $processId}}
