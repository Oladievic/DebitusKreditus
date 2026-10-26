param(
  [switch]$Check,
  [switch]$Smoke,
  [switch]$Stop,
  [switch]$NoBrowser,
  [switch]$NoInstall,
  [ValidateRange(1024, 65535)][int]$WebPort = 5173,
  [ValidateRange(1024, 65535)][int]$ApiPort = 8787
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$projectDirectory = Split-Path -Parent $PSScriptRoot

try {
  if ($Stop -and -not (Test-Path -LiteralPath (Join-Path $projectDirectory '.cache\launcher\instance.json') -PathType Leaf)) {
    Write-Host 'Локальный запуск этим скриптом не найден. Другие процессы не затронуты.'
    exit 0
  }
  $tools = & (Join-Path $PSScriptRoot 'runtime-tools.ps1') -ProjectDirectory $projectDirectory -NoInstall:($NoInstall -or $Check -or $Stop) -NodeOnly:$Stop
  $nodePath = $tools.Node
  $pnpmPath = $tools.Pnpm
  $launchArguments = @((Join-Path $PSScriptRoot 'start-local.mjs'), '--web-port', "$WebPort", '--api-port', "$ApiPort")
  if ($pnpmPath) { $launchArguments += @('--pnpm', $pnpmPath) }
  if ($Check) { $launchArguments += '--check' }
  if ($Smoke) { $launchArguments += '--smoke' }
  if ($Stop) { $launchArguments += '--stop' }
  if ($NoBrowser) { $launchArguments += '--no-browser' }
  if ($NoInstall) { $launchArguments += '--no-install' }
  Push-Location -LiteralPath $projectDirectory
  try {
    & $nodePath @launchArguments
    $result = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  exit $result
} catch {
  Write-Host ('Ошибка запуска: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
