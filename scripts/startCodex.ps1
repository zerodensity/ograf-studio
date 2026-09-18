[CmdletBinding()]
param(
  [string]$Model = 'default',
  [switch]$RestartMcp
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$codexCommand = Get-Command codex -ErrorAction SilentlyContinue
$codexExecutable = if ($codexCommand) { $codexCommand.Source } else { $null }
if (-not $codexExecutable -and $env:LOCALAPPDATA) {
  $codexBin = Join-Path $env:LOCALAPPDATA 'OpenAI/Codex/bin'
  if (Test-Path -LiteralPath $codexBin) {
    $codexExecutable = Get-ChildItem -Path "$codexBin/*/codex.exe" -File |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
  }
}
if (-not $codexExecutable) { throw 'Install Codex CLI or the Codex desktop app, then run this script again.' }
& $codexExecutable login status
if ($LASTEXITCODE -ne 0) { throw 'Sign in with codex login, then run this script again.' }

@{ provider = 'codex'; model = $Model; codexExecutable = $codexExecutable } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot '.ograf-agent.local') -Encoding utf8

if ($RestartMcp) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 4318 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($listenerId in $listeners) {
    $listener = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerId"
    if ($listener.CommandLine -notlike "*$projectRoot*" -or $listener.CommandLine -notmatch 'mcpMain\.ts') {
      throw 'Port 4318 belongs to another service. Stop it yourself before starting the Studio source MCP server.'
    }
    Stop-Process -Id $listenerId
  }
}

& (Join-Path $PSScriptRoot 'startAll.ps1')
Write-Host 'Codex settings saved locally. Future startAll.ps1 launches will use Codex.'
if (-not $RestartMcp) { Write-Host 'If the MCP server was already running with another provider, rerun with -RestartMcp.' }
