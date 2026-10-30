$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outputFolder=Join-Path $projectRoot '.test-artifacts\content-quality'
New-Item -ItemType Directory -Path $outputFolder -Force | Out-Null
Add-Type -AssemblyName System.Speech
$cases=Get-Content (Join-Path $projectRoot 'config\local-ai-quality-cases.json') -Raw -Encoding utf8 | ConvertFrom-Json
foreach($sample in ($cases|Where-Object kind -eq 'speech')){
  $synth=New-Object System.Speech.Synthesis.SpeechSynthesizer
  try{$synth.SelectVoice($sample.voice);$synth.Rate=0;$synth.SetOutputToWaveFile((Join-Path $outputFolder ($sample.id+'.wav')));$synth.Speak($sample.reference)}finally{$synth.Dispose()}
}
Write-Output 'Offline zh-TW quality fixtures ready; no cloud synthesis used.'
