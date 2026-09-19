[CmdletBinding()]
param([switch]$Lan)
. (Join-Path $PSScriptRoot 'common.ps1')
Import-CedarEnvironment
Assert-CedarToolchain
if (-not (Test-Path -LiteralPath (Join-Path $CedarRoot '.env'))) { throw 'Run scripts/setup-dev.ps1 first.' }
if (Test-Path -LiteralPath (Join-Path $CedarRoot '.local/cedar-cluster.marker')) { Start-CedarDatabase (Resolve-CedarPgBin) }
$logs = Join-Path $CedarRoot '.logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
foreach ($port in @([int]$env:SERVER_PORT,5173)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is occupied. Use stop-dev.ps1 for this application, or choose another port." }
}
$shell = Get-CedarPowerShell
$backendScript = Join-Path $CedarRoot 'scripts/run-backend.ps1'
$frontendScript = Join-Path $CedarRoot 'scripts/run-frontend.ps1'
$backendArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File', ('"' + $backendScript + '"'))
$frontendArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File', ('"' + $frontendScript + '"'))
if ($Lan) { $frontendArgs += '-Lan' }
$backend = Start-Process -FilePath $shell -ArgumentList $backendArgs -WorkingDirectory $CedarRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'backend.log') -RedirectStandardError (Join-Path $logs 'backend-error.log')
$frontend = Start-Process -FilePath $shell -ArgumentList $frontendArgs -WorkingDirectory $CedarRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'frontend.log') -RedirectStandardError (Join-Path $logs 'frontend-error.log')
@{backend=$backend.Id;frontend=$frontend.Id;root=$CedarRoot;startedAt=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs 'processes.json')
Write-Host 'Starting backend and frontend. Logs: .logs/backend.log and .logs/frontend.log'
$ready = $false
for ($attempt=0; $attempt -lt 120; $attempt++) {
    if ($backend.HasExited -or $frontend.HasExited) { throw 'A development process exited. Read .logs/*-error.log and .logs/*.log.' }
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:$($env:SERVER_PORT)/api/v1/restaurant" -TimeoutSec 2
        $null = Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -TimeoutSec 2
        $ready = $true
        break
    } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) { throw 'Startup exceeded two minutes. Processes remain running; inspect .logs/backend.log.' }
Write-Host 'The Cedar Table is ready: http://localhost:5173'
Write-Host 'Host: /host   Manager: /manager   Public display: /display'
if ($Lan) {
    Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Host "Phone/display URL: http://$($_.IPAddress):5173" }
    Write-Host 'Allow inbound TCP 5173 on Windows Private networks only. Keep PostgreSQL and backend local.'
}
Write-Host 'Stop application: .\scripts\stop-dev.ps1'
