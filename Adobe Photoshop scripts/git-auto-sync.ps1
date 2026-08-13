param(
    [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$Remote = 'origin',
    [string]$Branch = '',
    [string]$CommitMessage = '',
    [string]$MessagePrefix = 'chore: auto sync',
    [switch]$Watch,
    [int]$IntervalSeconds = 15,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$Message) {
    Write-Host "[git-auto-sync] $Message"
}

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Args,
        [switch]$IgnoreExitCode
    )

    $output = & git @Args 2>&1
    $exitCode = $LASTEXITCODE

    if (-not $IgnoreExitCode -and $exitCode -ne 0) {
        throw "git $($Args -join ' ') failed: $output"
    }

    return [PSCustomObject]@{
        Output = ($output -join "`n").Trim()
        ExitCode = $exitCode
    }
}

function Get-CurrentBranch {
    $branchResult = Invoke-Git -Args @('branch', '--show-current')
    return $branchResult.Output.Trim()
}

function Get-StatusText {
    $statusResult = Invoke-Git -Args @('status', '--short')
    return $statusResult.Output
}

function Get-CommitMessage([string]$ExplicitMessage, [string]$Prefix) {
    if ($ExplicitMessage.Trim()) {
        return $ExplicitMessage.Trim()
    }

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    return "$Prefix ($timestamp)"
}

function Sync-Repository {
    param(
        [string]$RemoteName,
        [string]$TargetBranch,
        [string]$ExplicitMessage,
        [string]$Prefix,
        [switch]$PreviewOnly
    )

    $statusText = Get-StatusText
    if ([string]::IsNullOrWhiteSpace($statusText)) {
        Write-Info 'No changes detected. Skip sync.'
        return $false
    }

    Write-Info 'Changes detected:'
    Write-Host $statusText

    $commitMessage = Get-CommitMessage -ExplicitMessage $ExplicitMessage -Prefix $Prefix

    if ($PreviewOnly) {
        Write-Info 'DryRun mode. Skip add/commit/push.'
        Write-Info 'Would run: git add -A'
        Write-Info "Would run: git commit -m `"$commitMessage`""
        Write-Info "Would run: git push $RemoteName $TargetBranch"
        return $true
    }

    Invoke-Git -Args @('add', '-A') | Out-Null

    $cachedDiff = Invoke-Git -Args @('diff', '--cached', '--quiet') -IgnoreExitCode
    if ($cachedDiff.ExitCode -eq 0) {
        Write-Info 'No staged diff after git add -A. Skip commit.'
        return $false
    }

    Write-Info "Committing: $commitMessage"
    Invoke-Git -Args @('commit', '-m', $commitMessage) | Out-Null

    Write-Info "Pushing to $RemoteName/$TargetBranch"
    Invoke-Git -Args @('push', $RemoteName, $TargetBranch) | Out-Null

    Write-Info 'Sync complete.'
    return $true
}

Set-Location $RepoPath

$insideWorkTree = Invoke-Git -Args @('rev-parse', '--is-inside-work-tree')
if ($insideWorkTree.Output.Trim() -ne 'true') {
    throw "Target path is not a git repository: $RepoPath"
}

$resolvedBranch = if ($Branch.Trim()) { $Branch.Trim() } else { Get-CurrentBranch }
if (-not $resolvedBranch) {
    throw 'Cannot determine current branch. Use -Branch.'
}

$remoteCheck = Invoke-Git -Args @('remote', 'get-url', $Remote) -IgnoreExitCode
if ($remoteCheck.ExitCode -ne 0) {
    throw "Remote does not exist: $Remote"
}

Write-Info "Repository: $RepoPath"
Write-Info "Remote: $Remote -> $($remoteCheck.Output)"
Write-Info "Branch: $resolvedBranch"

if (-not $Watch) {
    Sync-Repository -RemoteName $Remote -TargetBranch $resolvedBranch -ExplicitMessage $CommitMessage -Prefix $MessagePrefix -PreviewOnly:$DryRun | Out-Null
    exit 0
}

if ($IntervalSeconds -lt 5) {
    throw 'IntervalSeconds must be >= 5.'
}

Write-Info "Watch mode enabled. Poll interval: ${IntervalSeconds}s"
$lastStatus = Get-StatusText

while ($true) {
    Start-Sleep -Seconds $IntervalSeconds
    $currentStatus = Get-StatusText

    if ($currentStatus -eq $lastStatus) {
        continue
    }

    $lastStatus = $currentStatus

    if ([string]::IsNullOrWhiteSpace($currentStatus)) {
        Write-Info 'Working tree is clean again.'
        continue
    }

    try {
        $synced = Sync-Repository -RemoteName $Remote -TargetBranch $resolvedBranch -ExplicitMessage $CommitMessage -Prefix $MessagePrefix -PreviewOnly:$DryRun
        if ($synced -and -not $DryRun) {
            $lastStatus = Get-StatusText
        }
    } catch {
        Write-Info "Sync failed: $($_.Exception.Message)"
    }
}
