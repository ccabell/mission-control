param(
  [Parameter(Mandatory)][string]$DataDirectory,
  [Parameter(Mandatory)][string]$EnvironmentFile,
  [string]$ListenAddress = '127.0.0.1',
  [int]$Port = 3100
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
if (-not (Test-Path -LiteralPath '.next/standalone/server.js')) { throw 'Build the standalone artifact first' }
if (-not (Test-Path -LiteralPath $DataDirectory -PathType Container)) { throw 'Data directory does not exist' }
Get-Content -LiteralPath $EnvironmentFile | ForEach-Object {
  if ($_ -match '^([A-Z_][A-Z_0-9]*)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] }
}
# Native executables avoid the shell-only npm shims on Windows.
$claudeBin = Join-Path $env:APPDATA 'npm/node_modules/@anthropic-ai/claude-code/bin'
$codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue | Select-Object -First 1
$nativePaths = @($claudeBin)
if ($codexCommand) { $nativePaths += Split-Path -Parent $codexCommand.Source }
$env:PATH = ($nativePaths -join [IO.Path]::PathSeparator) + [IO.Path]::PathSeparator + $env:PATH
$env:PORT = [string]$Port
$env:HOSTNAME = $ListenAddress
$env:MC_ALLOWED_HOSTS = 'localhost,127.0.0.1,::1,100.79.143.126,desktop-f2n5lfh,desktop-f2n5lfh.tail397783.ts.net'
$env:MC_WORKSPACE_ROOT = 'C:\Projects2'
$env:MISSION_CONTROL_DATA_DIR = (Resolve-Path -LiteralPath $DataDirectory).Path
node .next/standalone/server.js *>> (Join-Path $DataDirectory 'mission-control.log')
exit $LASTEXITCODE
