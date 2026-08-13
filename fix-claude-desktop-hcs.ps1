param(
    [switch]$Apply,
    [switch]$Launch,
    [switch]$Restart
)

$ErrorActionPreference = 'Continue'
$LogPath = Join-Path $env:TEMP 'claude-desktop-hcs-fix.log'

function Write-Log {
    param([string]$Message)
    $line = '{0} {1}' -f (Get-Date).ToString('s'), $Message
    $line | Tee-Object -FilePath $LogPath -Append
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$identity
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Relaunch-AsAdmin {
    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    if ($Apply) { $args += '-Apply' }
    if ($Launch) { $args += '-Launch' }
    if ($Restart) { $args += '-Restart' }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $args
}

function Get-ClaudePackage {
    return Get-AppxPackage -Name Claude -ErrorAction SilentlyContinue |
        Sort-Object Version -Descending |
        Select-Object -First 1
}

function Write-Diagnostics {
    $pkg = Get-ClaudePackage
    Write-Log '=== Claude Desktop diagnostics ==='
    if ($pkg) {
        Write-Log ("Package: {0}" -f $pkg.PackageFullName)
        Write-Log ("Version: {0}" -f $pkg.Version)
        Write-Log ("InstallLocation: {0}" -f $pkg.InstallLocation)
        Write-Log ("Status: {0}" -f $pkg.Status)
    }
    else {
        Write-Log 'Package: not found'
    }

    foreach ($path in @(
        "$env:WINDIR\System32\vmcompute.dll",
        "$env:WINDIR\System32\computenetwork.dll",
        "$env:WINDIR\System32\hcsdiag.exe"
    )) {
        Write-Log ("File {0}: {1}" -f $path, (Test-Path $path))
    }

    foreach ($name in @('vmcompute', 'hns', 'winnat', 'SharedAccess', 'CoworkVMService')) {
        $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($svc) {
            Write-Log ("Service {0}: {1} ({2})" -f $svc.Name, $svc.Status, $svc.StartType)
        }
        else {
            Write-Log ("Service {0}: not found" -f $name)
        }
    }

    foreach ($feature in @(
        'Microsoft-Hyper-V-All',
        'VirtualMachinePlatform',
        'Windows-Hypervisor-Platform',
        'Containers'
    )) {
        try {
            $info = Get-WindowsOptionalFeature -Online -FeatureName $feature -ErrorAction Stop
            Write-Log ("Feature {0}: {1}" -f $info.FeatureName, $info.State)
        }
        catch {
            Write-Log ("Feature {0}: {1}" -f $feature, $_.Exception.Message)
        }
    }
}

function Enable-NeededFeatures {
    foreach ($feature in @(
        'Microsoft-Hyper-V-All',
        'VirtualMachinePlatform',
        'Windows-Hypervisor-Platform',
        'Containers'
    )) {
        try {
            $info = Get-WindowsOptionalFeature -Online -FeatureName $feature -ErrorAction Stop
            if ($info.State -ne 'Enabled') {
                Write-Log ("Enabling feature: {0}" -f $feature)
                Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart -ErrorAction Stop | Out-Null
            }
            else {
                Write-Log ("Feature already enabled: {0}" -f $feature)
            }
        }
        catch {
            Write-Log ("Skipping feature {0}: {1}" -f $feature, $_.Exception.Message)
        }
    }
}

function Repair-ClaudePackage {
    $pkg = Get-ClaudePackage
    if (-not $pkg) {
        Write-Log 'Claude package not found; skipping package repair.'
        return
    }

    $manifest = Join-Path $pkg.InstallLocation 'AppxManifest.xml'
    if (-not (Test-Path $manifest)) {
        Write-Log ("Manifest not found: {0}" -f $manifest)
        return
    }

    Write-Log 'Stopping CoworkVMService if running.'
    Stop-Service -Name CoworkVMService -Force -ErrorAction SilentlyContinue
    Get-Process cowork-svc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    Write-Log 'Re-registering Claude package.'
    Add-AppxPackage -DisableDevelopmentMode -Register $manifest
}

function Launch-Claude {
    Write-Log 'Launching Claude Desktop.'
    Start-Process -FilePath "$env:WINDIR\explorer.exe" -ArgumentList 'shell:AppsFolder\Claude_pzs8sxrjxfjjc!Claude'
    Start-Sleep -Seconds 8
    $procs = Get-Process | Where-Object { $_.ProcessName -match 'claude|cowork|Anthropic' } |
        Select-Object ProcessName,Id,Path
    if ($procs) {
        $procs | ConvertTo-Json -Depth 4 | Tee-Object -FilePath $LogPath -Append
    }
    else {
        Write-Log 'No Claude-related process found after launch attempt.'
    }
}

Write-Log ("Log: {0}" -f $LogPath)

if (-not (Test-IsAdmin)) {
    Write-Log 'Administrator rights are required for full diagnostics and repairs.'
    Relaunch-AsAdmin
    return
}

Write-Diagnostics

if ($Apply) {
    Enable-NeededFeatures
    Repair-ClaudePackage
    Write-Diagnostics
}
else {
    Write-Log 'Dry run only. Re-run with -Apply to enable Windows features and repair Claude.'
}

if ($Launch) {
    Launch-Claude
}

if ($Restart) {
    Write-Log 'Restart requested.'
    Restart-Computer
}
else {
    Write-Log 'If Windows features were enabled, restart Windows before launching Claude again.'
}
