# Registers the WhatsApp agent as a Scheduled Task that starts at logon and
# restarts itself if it dies — the Windows equivalent of the macOS LaunchAgent.
#
# Run from the agent folder:
#   powershell -ExecutionPolicy Bypass -File autostart.windows.ps1
#
# Remove later:
#   Unregister-ScheduledTask -TaskName "WhatsAppAgent" -Confirm:$false

param(
    [string]$AgentDir = $PSScriptRoot,
    [string]$TaskName = "WhatsAppAgent"
)

$ErrorActionPreference = "Stop"

$poller = Join-Path $AgentDir "poller.mjs"
if (-not (Test-Path $poller)) {
    Write-Error "poller.mjs not found in $AgentDir. Run this from the agent folder."
    exit 1
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Error "node not found on PATH. Install Node.js 18+ from https://nodejs.org"
    exit 1
}

Write-Host "node       : $node"
Write-Host "agent dir  : $AgentDir"

# A running poller holds a lock; a second one would refuse to start anyway, but stop
# it cleanly so the handover is not noisy.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*poller.mjs*" } |
    ForEach-Object {
        Write-Host "stopping running poller (pid $($_.ProcessId))"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "replacing existing task"
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$poller`"" -WorkingDirectory $AgentDir
$trigger = New-ScheduledTaskTrigger -AtLogOn

# RestartCount/RestartInterval are the KeepAlive equivalent: bring it back if it dies.
# ExecutionTimeLimit 0 means never kill a long-running job.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Personal WhatsApp agent poller" | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5

$state = (Get-ScheduledTask -TaskName $TaskName).State
Write-Host "task state : $state"

$running = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*poller.mjs*" }
if ($running) {
    Write-Host "poller running (pid $($running.ProcessId)) - the agent starts automatically from now on."
} else {
    Write-Warning "task registered but the poller is not running. Check $AgentDir\logs\ for errors."
}
