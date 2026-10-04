# Stops and removes the discord-scribe Scheduled Task. Recordings and logs are left untouched.
$ErrorActionPreference = 'Stop'
$TaskName = 'discord-scribe'
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Output "Removed scheduled task '$TaskName'"
