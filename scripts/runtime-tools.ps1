param(
  [Parameter(Mandatory = $true)][string]$ProjectDirectory,
  [switch]$NoInstall,
  [switch]$NodeOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = [IO.Path]::GetFullPath($ProjectDirectory)
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.engines.node -notmatch '^>=(24\.\d+\.\d+)\s+<25$') {
  throw 'Не удалось определить поддерживаемую версию Node.js из package.json.'
}
$nodeVersion = $Matches[1]
if ($manifest.packageManager -notmatch '^pnpm@(\d+\.\d+\.\d+)$') {
  throw 'Не удалось определить версию pnpm из package.json.'
}
$pnpmVersion = $Matches[1]
$runtimeRoot = Join-Path $projectRoot '.cache\runtime'
$nodeFolder = Join-Path $runtimeRoot "node-v$nodeVersion-win-x64"
$cachedNode = Join-Path $nodeFolder 'node.exe'
$pnpmFolder = Join-Path $runtimeRoot 'pnpm'
$cachedPnpm = Join-Path $pnpmFolder 'pnpm.cmd'

function Get-DebitusFileHash([string]$File) {
  $stream = [IO.File]::OpenRead($File)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Expand-DebitusNode([string]$Archive) {
  [void][Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem')
  $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
  $allowedRoot = $nodeFolder + [IO.Path]::DirectorySeparatorChar
  try {
    foreach ($entry in $zip.Entries) {
      $destination = [IO.Path]::GetFullPath((Join-Path $runtimeRoot $entry.FullName))
      if (-not $destination.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase) -and $destination -ne $nodeFolder) {
        throw 'Архив Node.js содержит путь вне папки runtime.'
      }
      if ($entry.FullName.EndsWith('/')) { [void][IO.Directory]::CreateDirectory($destination) }
      else {
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
      }
    }
  } finally { $zip.Dispose() }
}

function Test-DebitusNode([string]$File) {
  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
  try {
    $versionText = [string](& $File --version 2>$null | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v(\d+\.\d+\.\d+)$') { return $false }
    $version = [version]$Matches[1]
    return $version.Major -eq 24 -and $version -ge [version]$nodeVersion
  } catch { return $false }
}

function Find-DebitusNode {
  $candidates = @(
    Get-Command node.exe -All -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $_.Source }
    $cachedNode
    if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
    if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe' }
  )
  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if (Test-DebitusNode $candidate) { return $candidate }
  }
  return $null
}

function Find-DebitusPnpm {
  $candidates = @(
    $cachedPnpm
    Get-Command pnpm.cmd,pnpm.exe -All -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $_.Source }
    if ($env:APPDATA) { Join-Path $env:APPDATA 'npm\pnpm.cmd' }
    if ($env:PNPM_HOME) { Join-Path $env:PNPM_HOME 'pnpm.cmd' }
  )
  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    try {
      $versionText = [string](& $candidate --version 2>$null | Select-Object -Last 1)
      if ($LASTEXITCODE -eq 0 -and $versionText.Trim() -eq $pnpmVersion) { return $candidate }
    } catch {}
  }
  return $null
}

function Install-DebitusNode {
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Для локального комплекта нужна Windows x64.' }
  Write-Host "Подготавливаем Node.js $nodeVersion в папке проекта. При первом запуске нужен интернет."
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $archiveName = "node-v$nodeVersion-win-x64.zip"
  $archive = Join-Path $runtimeRoot $archiveName
  $checksums = Join-Path $runtimeRoot 'SHASUMS256.txt'
  $releaseUrl = "https://nodejs.org/dist/v$nodeVersion"
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/SHASUMS256.txt" -OutFile $checksums -TimeoutSec 120
    $checksumLine = Get-Content -LiteralPath $checksums | Where-Object { $_ -match ("  " + [regex]::Escape($archiveName) + '$') } | Select-Object -First 1
    if (-not $checksumLine -or $checksumLine -notmatch '^([a-fA-F0-9]{64})\s+') { throw 'В официальном списке отсутствует контрольная сумма архива.' }
    $expectedHash = $Matches[1]
    $cachedArchiveValid = (Test-Path -LiteralPath $archive -PathType Leaf) -and ((Get-DebitusFileHash $archive) -eq $expectedHash)
    if (-not $cachedArchiveValid) {
      $partialArchive = "$archive.download"
      Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$archiveName" -OutFile $partialArchive -TimeoutSec 180
      if ((Get-DebitusFileHash $partialArchive) -ne $expectedHash) { throw 'Контрольная сумма Node.js не совпала. Архив не запущен.' }
      Move-Item -LiteralPath $partialArchive -Destination $archive -Force
    }
    Expand-DebitusNode $archive
  } catch {
    throw ('Не удалось подготовить Node.js. Проверьте доступ к nodejs.org и повторите запуск. ' + $_.Exception.Message)
  }
  if (-not (Test-DebitusNode $cachedNode)) { throw 'Подготовленный Node.js не прошёл проверку версии.' }
  return $cachedNode
}

$nodePath = Find-DebitusNode
if ($nodePath) { $env:PATH = (Split-Path -Parent $nodePath) + [IO.Path]::PathSeparator + $env:PATH }
if ($NodeOnly) {
  if (-not $nodePath) { throw 'Для остановки не найден подходящий Node.js. Состояние запуска сохранено; посторонние процессы не затронуты.' }
  return [pscustomobject]@{ Node = $nodePath; Pnpm = $null }
}
$pnpmPath = if ($nodePath) { Find-DebitusPnpm } else { $null }
if ($NoInstall -and (-not $nodePath -or -not $pnpmPath)) {
  $missing = if (-not $nodePath) { "Node.js >=$nodeVersion <25" } else { "pnpm $pnpmVersion" }
  throw "Не найден $missing. Запустите Start-Debitus.cmd без -Check и -NoInstall: он подготовит инструменты в папке проекта. Для первой подготовки нужен интернет."
}

if (-not $nodePath -or -not $pnpmPath) {
  [void][IO.Directory]::CreateDirectory($runtimeRoot)
  $lock = $null
  $deadline = [DateTime]::UtcNow.AddMinutes(5)
  $waiting = $false
  while (-not $lock) {
    try {
      $lock = [IO.File]::Open((Join-Path $runtimeRoot 'prepare.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch [IO.IOException] {
      if (($_.Exception.HResult -band 65535) -notin 32,33) { throw }
      if ([DateTime]::UtcNow -ge $deadline) { throw 'Подготовка инструментов в другом окне ещё не завершилась. Дождитесь её окончания и повторите запуск.' }
      if (-not $waiting) { Write-Host 'Другое окно уже готовит инструменты. Ожидаем завершения.'; $waiting = $true }
      Start-Sleep -Milliseconds 300
    }
  }
  try {
    $nodePath = Find-DebitusNode
    if (-not $nodePath) { $nodePath = Install-DebitusNode }
    $env:PATH = (Split-Path -Parent $nodePath) + [IO.Path]::PathSeparator + $env:PATH
    $pnpmPath = Find-DebitusPnpm
    if (-not $pnpmPath) {
      $npmCli = Join-Path (Split-Path -Parent $nodePath) 'node_modules\npm\bin\npm-cli.js'
      if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
        $nodePath = Install-DebitusNode
        $env:PATH = (Split-Path -Parent $nodePath) + [IO.Path]::PathSeparator + $env:PATH
        $npmCli = Join-Path $nodeFolder 'node_modules\npm\bin\npm-cli.js'
      }
      Write-Host "Подготавливаем pnpm $pnpmVersion в папке проекта."
      $installLog = Join-Path $runtimeRoot 'install-pnpm.log'
      $previousErrorPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        & $nodePath $npmCli install --global --prefix $pnpmFolder "pnpm@$pnpmVersion" --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --cache (Join-Path $runtimeRoot 'npm-cache') *> $installLog
        $installExitCode = $LASTEXITCODE
      } finally { $ErrorActionPreference = $previousErrorPreference }
      if ($installExitCode -ne 0) { throw 'Не удалось подготовить pnpm. Проверьте интернет и повторите запуск. Подробности: .cache/runtime/install-pnpm.log.' }
      $pnpmPath = Find-DebitusPnpm
      if (-not $pnpmPath) { throw 'Подготовленный pnpm не прошёл проверку версии. Подробности: .cache/runtime/install-pnpm.log.' }
    }
  } finally { $lock.Dispose() }
}

$env:PATH = (Split-Path -Parent $nodePath) + [IO.Path]::PathSeparator + (Split-Path -Parent $pnpmPath) + [IO.Path]::PathSeparator + $env:PATH
[pscustomobject]@{ Node = $nodePath; Pnpm = $pnpmPath }
