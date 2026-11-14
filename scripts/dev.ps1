[CmdletBinding()]
param([switch]$Lan, [switch]$Ngrok)
. (Join-Path $PSScriptRoot 'common.ps1')
Import-CedarEnvironment
Assert-CedarToolchain
if (-not (Test-Path -LiteralPath (Join-Path $CedarRoot '.env'))) { throw 'Run scripts/setup.ps1 first.' }
if (Test-Path -LiteralPath (Join-Path $CedarRoot '.local/cedar-cluster.marker')) { Start-CedarDatabase (Resolve-CedarPgBin) }
$logs = Join-Path $CedarRoot '.logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
foreach ($port in @([int]$env:SERVER_PORT,5173)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is occupied. Use stop-dev.ps1 for this application, or choose another port." }
}
if ($Ngrok) {
    if (-not (Get-Command ngrok.exe -ErrorAction SilentlyContinue)) { throw 'ngrok is not installed or not in PATH.' }
}
$shell = Get-CedarPowerShell

$backendCode = ". `"$PSScriptRoot\common.ps1`"; Import-CedarEnvironment; Set-Location `"$CedarRoot\backend`"; & '.\gradlew.bat' bootRun; exit `$LASTEXITCODE"
$backendBytes = [System.Text.Encoding]::Unicode.GetBytes($backendCode)
$backendArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand', [Convert]::ToBase64String($backendBytes))

$frontendHost = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
$frontendCode = ". `"$PSScriptRoot\common.ps1`"; Import-CedarEnvironment; Set-Location `"$CedarRoot\frontend`"; & bun run dev --host $frontendHost; exit `$LASTEXITCODE"
$frontendBytes = [System.Text.Encoding]::Unicode.GetBytes($frontendCode)
$frontendArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand', [Convert]::ToBase64String($frontendBytes))

$backend = Start-Process -FilePath $shell -ArgumentList $backendArgs -WorkingDirectory $CedarRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'backend.log') -RedirectStandardError (Join-Path $logs 'backend-error.log')
$frontend = Start-Process -FilePath $shell -ArgumentList $frontendArgs -WorkingDirectory $CedarRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'frontend.log') -RedirectStandardError (Join-Path $logs 'frontend-error.log')

$processes = @{backend=$backend.Id;frontend=$frontend.Id;root=$CedarRoot;startedAt=(Get-Date).ToString('o')}

if ($Ngrok) {
    $ngrokCode = "ngrok http 5173 --log `"$logs\ngrok.log`"; exit `$LASTEXITCODE"
    $ngrokBytes = [System.Text.Encoding]::Unicode.GetBytes($ngrokCode)
    $ngrokArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand', [Convert]::ToBase64String($ngrokBytes))
    $ngrokProc = Start-Process -FilePath $shell -ArgumentList $ngrokArgs -WorkingDirectory $CedarRoot -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $logs 'ngrok-error.log')
    $processes['ngrok'] = $ngrokProc.Id
}

$processes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs 'processes.json')
Write-Host 'Starting backend and frontend. Logs: .logs/backend.log and .logs/frontend.log'
$ready = $false
for ($attempt=0; $attempt -lt 120; $attempt++) {
    if ($backend.HasExited -or $frontend.HasExited) { throw 'A development process exited. Read .logs/*-error.log and .logs/*.log.' }
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:$($env:SERVER_PORT)/api/v1/restaurant" -TimeoutSec 2 -UseBasicParsing
        $null = Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -TimeoutSec 2 -UseBasicParsing
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
if ($Ngrok) {
    Write-Host 'Waiting for ngrok to initialize...'
    Start-Sleep -Seconds 2
    try {
        $tunnels = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels'
        $publicUrl = $tunnels.tunnels[0].public_url
        Write-Host "Ngrok public URL: $publicUrl"
    } catch {
        Write-Host "Ngrok started but could not fetch public URL from local API (http://127.0.0.1:4040)."
    }
}
Write-Host 'Stop application: .\scripts\stop-dev.ps1'
