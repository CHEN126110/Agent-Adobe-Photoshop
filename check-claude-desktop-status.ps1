param(
    [switch]$Launch
)

$ErrorActionPreference = 'Continue'
$ReportPath = Join-Path $env:TEMP 'claude-desktop-status.json'

function Get-RecentClaudeEvents {
    try {
        Get-WinEvent -LogName 'Microsoft-Windows-AppModel-Runtime/Admin' -MaxEvents 20 |
            Where-Object { $_.Message -match 'Claude|pzs8sxrjxfjjc|0x' } |
            Select-Object TimeCreated, Id, LevelDisplayName,
                @{ Name = 'Message'; Expression = { $_.Message -replace "`r?`n", ' ' } }
    }
    catch {
        @([PSCustomObject]@{ Error = $_.Exception.Message })
    }
}

if ($Launch) {
    Start-Process -FilePath "$env:WINDIR\explorer.exe" -ArgumentList 'shell:AppsFolder\Claude_pzs8sxrjxfjjc!Claude'
    Start-Sleep -Seconds 10
}

$files = foreach ($path in @(
    "$env:WINDIR\System32\vmcompute.dll",
    "$env:WINDIR\System32\computenetwork.dll",
    "$env:WINDIR\System32\hcsdiag.exe"
)) {
    [PSCustomObject]@{
        Path = $path
        Exists = Test-Path $path
    }
}

$report = [PSCustomObject]@{
    Timestamp = (Get-Date).ToString('o')
    BootTime = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
    ClaudePackage = Get-AppxPackage -Name Claude -ErrorAction SilentlyContinue |
        Select-Object Name, Version, PackageFullName, Status, InstallLocation
    Processes = Get-Process |
        Where-Object { $_.ProcessName -match 'claude|cowork|Anthropic' } |
        Select-Object ProcessName, Id, Path
    HcsFiles = $files
    RecentEvents = Get-RecentClaudeEvents
}

$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 8
