#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw '此脚本仅用于 Windows。' }
$moyuLogs = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../work/android-launch'))
New-Item -ItemType Directory -Path $moyuLogs -Force | Out-Null
$moyuReceipt = Join-Path $moyuLogs 'acceleration-setup.json'
try {
    $moyuFeature = Get-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform
    $moyuRestart = $false
    if ($moyuFeature.State -eq 'Enabled') {
        Write-Host 'Windows 虚拟机监控程序平台已启用。若模拟器仍无法使用加速，请先重启电脑。'
    } else {
        $moyuResult = Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All -NoRestart
        $moyuRestart = [bool]$moyuResult.RestartNeeded
        Write-Host 'Windows 虚拟机监控程序平台已启用。请保存工作后自行重启电脑，再运行 start-android.cmd。'
    }
    @{ok=$true;state=(Get-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform).State.ToString();restartNeeded=$moyuRestart;time=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $moyuReceipt -Encoding utf8
} catch {
    @{ok=$false;error=$_.Exception.Message;time=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $moyuReceipt -Encoding utf8
    throw
}
