# Git 自动同步

本项目提供一个本地 PowerShell 脚本，用于把当前工作区改动自动提交并推送到当前 Git 远端。

脚本位置：

- [git-auto-sync.ps1](/C:/UXP/2.0/scripts/git-auto-sync.ps1)

## 默认行为

- 仓库：当前工作区 `C:\UXP\2.0`
- 远端：`origin`
- 分支：当前分支
- 提交信息：`chore: auto sync (时间戳)`

## 单次同步

```powershell
Set-Location C:\UXP\2.0
.\scripts\git-auto-sync.ps1
```

## 持续监听并自动推送

```powershell
Set-Location C:\UXP\2.0
.\scripts\git-auto-sync.ps1 -Watch
```

## 先看不执行

```powershell
Set-Location C:\UXP\2.0
.\scripts\git-auto-sync.ps1 -DryRun
```

## 自定义提交信息

```powershell
.\scripts\git-auto-sync.ps1 -CommitMessage "chore: sync latest local changes"
```

## 自定义轮询间隔

```powershell
.\scripts\git-auto-sync.ps1 -Watch -IntervalSeconds 30
```

## 说明

- 脚本只会在检测到真实改动时执行 `git add -A`、`git commit`、`git push`
- 如果 `git add -A` 后没有缓存差异，不会创建空提交
- 默认不会自动启动后台进程，需要你手动执行
- 如果你希望开机后自动同步，可以再把这个脚本挂到计划任务或 IDE 启动项里
