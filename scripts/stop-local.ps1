$ErrorActionPreference = 'Stop'
$localRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localPidFile = Join-Path $localRoot 'data\runtime\server.json'
if (!(Test-Path -LiteralPath $localPidFile)) { Write-Output 'Hra nie je spustená týmto spúšťačom.'; exit 0 }
$localRecord = Get-Content -LiteralPath $localPidFile -Raw | ConvertFrom-Json
$localPid = 0
if ($localRecord.root -ne $localRoot -or ![int]::TryParse([string]$localRecord.pid, [ref]$localPid)) { throw 'Záznam procesu nie je platný.' }
$localRootProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($localRecord.pid)" -ErrorAction SilentlyContinue
if (!$localRootProcess) { Remove-Item -LiteralPath $localPidFile; Write-Output 'Hra už je zastavená.'; exit 0 }
if ($localRootProcess.CommandLine -notlike '*scripts/run-framework.mjs*dev*127.0.0.1*4175*') { throw 'Proces nezodpovedá lokálnej hre. Nezastavil som ho.' }
$localProcesses = @(Get-CimInstance Win32_Process)
$localIds = [System.Collections.Generic.HashSet[int]]::new()
[void]$localIds.Add([int]$localRecord.pid)
do {
  $localAdded=$false
  foreach ($localProcess in $localProcesses) {
    if ($localIds.Contains([int]$localProcess.ParentProcessId) -and $localIds.Add([int]$localProcess.ProcessId)) { $localAdded=$true }
  }
} while ($localAdded)
$localIds | Where-Object { $_ -ne [int]$localRecord.pid } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Stop-Process -Id ([int]$localRecord.pid) -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $localPidFile
Write-Output 'Lokálna hra je zastavená.'
