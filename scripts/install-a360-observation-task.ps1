param(
    [string]$SecretFile = 'C:/Projects2/.secrets/builderz-mission-control.env'
)
$ErrorActionPreference = 'Stop'
$taskName = 'A360-Builderz-Observations'
$publisher = Join-Path $PSScriptRoot 'publish-a360-observations.mjs'
if (-not (Test-Path -LiteralPath $SecretFile -PathType Leaf)) { throw 'Central Builderz environment file is missing' }
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw 'Observation task already exists; inspect ownership before changing it'
}
$nodePath = (Get-Command node -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $nodePath -Argument "--env-file=`"$SecretFile`" `"$publisher`"" -WorkingDirectory (Split-Path $PSScriptRoot -Parent)
$triggers = @(
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)),
    (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME")
)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'A360D-135: publish allowlisted relay metadata to hosted Builderz; no model calls or relay writes.' | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Installed minute-by-minute observation publishing for the signed-in Windows session. No credentials changed.'
