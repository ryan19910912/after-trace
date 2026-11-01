$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outputFolder=Join-Path $projectRoot '.test-artifacts\content-quality'
New-Item -ItemType Directory -Path $outputFolder -Force|Out-Null
Add-Type -AssemblyName System.Speech
$cases=Get-Content (Join-Path $projectRoot 'config\local-ai-quality-cases.json') -Raw -Encoding utf8|ConvertFrom-Json
foreach($sample in ($cases|Where-Object kind -eq 'speech')){
  $synth=New-Object System.Speech.Synthesis.SpeechSynthesizer
  try{$voices=@($synth.GetInstalledVoices()|Where-Object Enabled);$voice=$voices|Where-Object{$_.VoiceInfo.Name -eq $sample.voice}|Select-Object -First 1;if(!$voice){$voice=$voices|Where-Object{$_.VoiceInfo.Culture.Name -eq 'zh-TW'}|Select-Object -First 1};if(!$voice){throw '請先安裝 Windows 繁體中文離線語音，再產生測試素材。'};$synth.SelectVoice($voice.VoiceInfo.Name);$synth.Rate=0;$synth.SetOutputToWaveFile((Join-Path $outputFolder ($sample.id+'.wav')));$synth.Speak($sample.reference);Write-Output ($sample.id+' generated with '+$voice.VoiceInfo.Name)}finally{$synth.Dispose()}
}
Write-Output 'Offline Chinese fixtures ready; no cloud synthesis used.'
