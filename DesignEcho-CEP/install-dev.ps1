# DesignEcho CEP 开发版安装：复制扩展到 CEP 目录 + 打开各版本的未签名调试开关（PlayerDebugMode）。
# 用法：右键“使用 PowerShell 运行”，或在终端执行。装完重启 Photoshop，在 窗口→扩展 里打开 DesignEcho。
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dst = Join-Path $env:APPDATA 'Adobe\CEP\extensions\DesignEcho-CEP'

New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
Write-Output "已复制到 $dst"

# CSXS.9 = PS2019；CSXS.10 = PS2021；CSXS.11 = PS2022+（CEP 面板在这些版本仍可用）
foreach ($v in 9, 10, 11) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -Type String
    Write-Output "PlayerDebugMode=1 -> CSXS.$v"
}
Write-Output '完成。重启 Photoshop 后：窗口 → 扩展（旧版）→ DesignEcho；并确保 DesignEcho Agent 应用已启动。'
