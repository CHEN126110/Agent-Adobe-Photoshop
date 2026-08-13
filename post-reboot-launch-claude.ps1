$ErrorActionPreference = 'Continue'

$TaskName = 'ClaudeDesktopPostRebootCheck'
$RunOnceName = 'ClaudeDesktopPostRebootCheck'
$Report = Join-Path $env:TEMP 'claude-desktop-post-reboot.txt'

try {
    "Started: $((Get-Date).ToString('o'))" | Set-Content -LiteralPath $Report -Encoding UTF8
    powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\UXP\2.0\check-claude-desktop-status.ps1' -Launch |
        Tee-Object -FilePath $Report -Append
}
finally {
    schtasks.exe /Delete /TN $TaskName /F | Out-Null
    Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Name $RunOnceName -ErrorAction SilentlyContinue
    "Finished: $((Get-Date).ToString('o'))" | Add-Content -LiteralPath $Report -Encoding UTF8
}
