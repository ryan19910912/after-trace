$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outputFolder=Join-Path $projectRoot '.test-artifacts\content-quality'
New-Item -ItemType Directory -Path $outputFolder -Force|Out-Null
Add-Type -AssemblyName System.Speech
$synth=New-Object System.Speech.Synthesis.SpeechSynthesizer
try{$voice=$synth.GetInstalledVoices()|Where-Object{$_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-TW'}|Select-Object -First 1;if(!$voice){throw '請先安裝 Windows 繁體中文離線語音，再執行此測試素材產生器。'};$synth.SelectVoice($voice.VoiceInfo.Name);$synth.Rate=0;$synth.SetOutputToWaveFile((Join-Path $outputFolder 'S3.wav'));$synth.Speak('十一月二日上午九點半，在台北辦公室開會，討論登入功能測試。')}finally{$synth.Dispose()}
Write-Output 'Offline zh-TW audio fixture ready; no cloud synthesis used.'
