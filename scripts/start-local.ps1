param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$localRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localRuntimeDir = Join-Path $localRoot 'data\runtime'
[IO.Directory]::CreateDirectory($localRuntimeDir) | Out-Null
$localStorageLease = $null
try {
  try {
    $localStorageLease = [IO.File]::Open((Join-Path $localRuntimeDir 'storage-operation.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  } catch [IO.IOException] {
    throw 'Práve prebieha spúšťanie alebo zálohovanie hry. Po jeho dokončení skús znova.'
  }
  $localUrl = 'http://127.0.0.1:4175'
  $localManifest = Get-Content -LiteralPath (Join-Path $localRoot '.openai\hosting.json') -Raw | ConvertFrom-Json
  if ($localManifest.project_id) { throw 'Tento spúšťač je určený iba pre lokálnu kópiu bez hostingu.' }
  $localRuntime = Join-Path $localRoot '.runtime\node\node.exe'
  if (!(Test-Path -LiteralPath $localRuntime)) { $localRuntime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
  if (!(Test-Path -LiteralPath $localRuntime)) {
    $localNodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (!$localNodeCommand) { throw 'Chýba Node.js. Nainštaluj Node.js 22.13 alebo novší.' }
    $localRuntime = $localNodeCommand.Source
  }
  if (!(Test-Path -LiteralPath (Join-Path $localRoot 'node_modules\vinext\dist\cli.js'))) { throw 'Chýbajú závislosti aplikácie. Pozri README.md.' }
  Set-Location -LiteralPath $localRoot
  $env:PATH = [IO.Path]::GetDirectoryName($localRuntime) + ';' + $env:PATH
  $buildKnowledge = {
    Write-Output 'Pripravujem Grimoár Magnum Opus Knowledge…'
    & $localRuntime 'scripts/build-knowledge-app.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Grimoár sa nepodarilo zostaviť. Hra ani uložené dáta neboli zmenené.' }
  }
  $prepareStorage = {
    $env:WRANGLER_SEND_METRICS = 'false'
    $env:WRANGLER_WRITE_LOGS = 'false'
    $env:CI = '1'
    Write-Output 'Pripravujem lokálne úložisko…'
    & $localRuntime 'node_modules/wrangler/bin/wrangler.js' d1 migrations apply DB --local --persist-to '.wrangler/state' --config 'wrangler.local.json' *> (Join-Path $localRuntimeDir 'migrations.log')
    if ($LASTEXITCODE -ne 0) { throw 'Lokálne úložisko sa nepodarilo pripraviť. Dáta zostali zachované.' }
  }
  $localPidFile = Join-Path $localRuntimeDir 'server.json'
  $localListener = Get-NetTCPConnection -LocalPort 4175 -State Listen -ErrorAction SilentlyContinue
  if ($localListener) {
    $localRunning = $null
    if (Test-Path -LiteralPath $localPidFile) { $localRunning = Get-Content -LiteralPath $localPidFile -Raw | ConvertFrom-Json }
    $localProcess = if ($localRunning) { Get-CimInstance Win32_Process -Filter "ProcessId=$($localRunning.pid)" -ErrorAction SilentlyContinue }
    if (!$localProcess -or $localRunning.root -ne $localRoot -or $localProcess.CommandLine -notlike '*scripts/run-framework.mjs*dev*127.0.0.1*4175*') { throw 'Port 4175 už používa iný proces. Žiadny proces som nezastavil.' }
    & $buildKnowledge
    & $prepareStorage
    if (!$NoOpen) { Start-Process $localUrl }
    Write-Output $localUrl
    exit 0
  }
  & $buildKnowledge
  $env:CLOUDFLARE_CF_FETCH_ENABLED = 'false'
  $env:WRANGLER_SEND_METRICS = 'false'
  $env:WRANGLER_WRITE_LOGS = 'false'
  $env:MAGNUM_LOCAL_MODE = '1'
  & $prepareStorage
  $localServer = Start-Process -FilePath $localRuntime -ArgumentList @('scripts/run-framework.mjs','dev','--hostname','127.0.0.1','--port','4175','--strictPort') -WorkingDirectory $localRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $localRuntimeDir 'server.log') -RedirectStandardError (Join-Path $localRuntimeDir 'server-error.log') -PassThru
  [IO.File]::WriteAllText($localPidFile, (@{ pid=$localServer.Id; root=$localRoot; url=$localUrl; startedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  $localReady = $false
  for ($localAttempt=0; $localAttempt -lt 60; $localAttempt++) {
    if ($localServer.HasExited) { throw 'Spustenie hry sa nepodarilo. Podrobnosti sú v data/runtime/server-error.log.' }
    try {
      $localStatus = Invoke-RestMethod -Uri ($localUrl + '/api/auth/session') -TimeoutSec 2
      if ($localStatus.localMode -eq $true) { $localReady=$true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (!$localReady) { throw 'Server sa ešte nepripravil. Skontroluj data/runtime/server.log alebo spusti Zastavit.cmd.' }
  if (!$NoOpen) { Start-Process $localUrl }
  Write-Output $localUrl
} finally {
  if ($localStorageLease) { $localStorageLease.Dispose() }
}
