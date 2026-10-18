$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$zzySpeech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$zzySpeech.GetInstalledVoices() | ForEach-Object { Write-Output $_.VoiceInfo.Name }
$zzyVoices = $zzySpeech.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh*' }
if ($zzyVoices.Count -gt 0) { $zzySpeech.SelectVoice($zzyVoices[0].VoiceInfo.Name) }
$zzySpeech.Rate = 0
$zzySpeech.SetOutputToWaveFile((Join-Path $PSScriptRoot 'public/voice-demo.wav'))
$zzySpeech.Speak('您好，这里是宠物医院智能前台。您的预约信息已代填为草稿，尚未预约成功。请等待前台核对并人工确认。')
$zzySpeech.Dispose()
