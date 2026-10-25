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
  if (Get-NetTCPConnection -LocalPort 4175 -State Listen -ErrorAction SilentlyContinue) { throw 'Najprv ulož prácu a spusti Zastavit.cmd. Záloha potrebuje zastavené úložisko.' }
  $localState = Join-Path $localRoot '.wrangler\state'
  if (!(Test-Path -LiteralPath $localState)) { throw 'Zatiaľ nie je čo zálohovať. Najprv spusti hru.' }
  $localBackupDir = Join-Path $localRoot 'backups'
  [IO.Directory]::CreateDirectory($localBackupDir) | Out-Null
  $localBackup = Join-Path $localBackupDir ('magnum-opus-local-' + (Get-Date -Format 'yyyy-MM-dd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6) + '.zip')
  # Include .wrangler explicitly: Compress-Archive omits hidden dot directories on some hosts.
  $localNode = Join-Path $localRoot '.runtime\node\node.exe'
  if (!(Test-Path -LiteralPath $localNode)) { $localNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
  if (!(Test-Path -LiteralPath $localNode)) { $localNode = (Get-Command node -ErrorAction Stop).Source }
  & $localNode (Join-Path $PSScriptRoot 'backup-local.mjs') $localRoot $localBackup
  if ($LASTEXITCODE -ne 0) { throw 'Zálohu sa nepodarilo dokončiť.' }
  Write-Output $localBackup
} finally {
  if ($localStorageLease) { $localStorageLease.Dispose() }
}
