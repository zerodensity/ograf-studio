[CmdletBinding()]
param(
  [ValidateRange(5, 300)]
  [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot '.logs'
$editorUrl = 'http://localhost:5173/'
$mcpHealthUrl = 'http://127.0.0.1:4318/health'
$mcpUrl = 'http://127.0.0.1:4318/mcp'

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

function Test-HttpEndpoint {
  param([Parameter(Mandatory)][string]$Uri)

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  } catch {
    return $false
  }
}

function Start-OgrafService {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$StdoutLog,
    [Parameter(Mandatory)][string]$StderrLog
  )

  $process = Start-Process `
    -FilePath 'npm.cmd' `
    -ArgumentList $Arguments `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog `
    -WindowStyle Hidden `
    -PassThru

  Write-Host "$Name starting (launcher PID $($process.Id))..."
}

$editorWasRunning = Test-HttpEndpoint -Uri $editorUrl
$mcpWasRunning = Test-HttpEndpoint -Uri $mcpHealthUrl

if ($editorWasRunning) {
  Write-Host 'Editor is already online.'
} else {
  Start-OgrafService `
    -Name 'Editor' `
    -Arguments @('run', 'dev') `
    -StdoutLog (Join-Path $logDirectory 'editor-dev.out.log') `
    -StderrLog (Join-Path $logDirectory 'editor-dev.err.log')
}

if ($mcpWasRunning) {
  Write-Host 'MCP server is already online.'
} else {
  Start-OgrafService `
    -Name 'MCP server' `
    -Arguments @('run', 'mcp:start') `
    -StdoutLog (Join-Path $logDirectory 'mcp-server.out.log') `
    -StderrLog (Join-Path $logDirectory 'mcp-server.err.log')
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$editorReady = $editorWasRunning
$mcpReady = $mcpWasRunning

while ((-not $editorReady -or -not $mcpReady) -and (Get-Date) -lt $deadline) {
  if (-not $editorReady) { $editorReady = Test-HttpEndpoint -Uri $editorUrl }
  if (-not $mcpReady) { $mcpReady = Test-HttpEndpoint -Uri $mcpHealthUrl }
  if (-not $editorReady -or -not $mcpReady) { Start-Sleep -Milliseconds 500 }
}

if (-not $editorReady -or -not $mcpReady) {
  Write-Error "Startup timed out. Editor ready: $editorReady; MCP ready: $mcpReady. Check $logDirectory."
}

$health = Invoke-RestMethod -Uri $mcpHealthUrl -TimeoutSec 5

Write-Host ''
Write-Host "OGraf Studio: $editorUrl"
Write-Host "MCP server:    $mcpUrl"
Write-Host "MCP health:    ok=$($health.ok), editorConnected=$($health.editorConnected)"
Write-Host "Logs:          $logDirectory"
