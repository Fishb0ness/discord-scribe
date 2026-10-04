# Installs discord-scribe as a Scheduled Task that starts at logon and restarts on failure.
# Usage (PowerShell): .\scripts\install-service-windows.ps1 [-DryRun]
#   -DryRun prints what would be registered and changes nothing.
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'

$TaskName = 'discord-scribe'
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Node = (Get-Command node -ErrorAction Stop).Source
$Tsx = Join-Path $ProjectDir 'node_modules\tsx\dist\cli.mjs'
$LogDir = Join-Path $ProjectDir 'logs'
$Log = Join-Path $LogDir 'discord-scribe.log'
$ErrLog = Join-Path $LogDir 'discord-scribe.err.log'

# cmd.exe wraps node only to redirect stdout/stderr to the log files.
$Arguments = "/d /c `"`"$Node`" `"$Tsx`" src/main.ts >> `"$Log`" 2>> `"$ErrLog`"`""

if ($DryRun) {
  Write-Output "Task:       $TaskName (at logon of $env:USERNAME, restart on failure every 1 minute, up to 999 times)"
  Write-Output "Program:    cmd.exe"
  Write-Output "Arguments:  $Arguments"
  Write-Output "WorkingDir: $ProjectDir"
  exit 0
}

if (-not (Test-Path (Join-Path $ProjectDir '.env'))) { throw "Missing $ProjectDir\.env (copy .env.example and fill it in first)" }
if (-not (Test-Path (Join-Path $ProjectDir 'node_modules'))) { throw "Run 'npm install' first" }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $Arguments -WorkingDirectory $ProjectDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Output "Installed scheduled task '$TaskName'"
Write-Output "  logs:   $Log (stdout), $ErrLog (stderr)"
Write-Output "  status: Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
Write-Output "Note: stopping the task kills the bot without a graceful shutdown (Windows has no SIGTERM)."
