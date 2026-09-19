[CmdletBinding()]
param([int]$Port=8081,[switch]$SkipBuild,[switch]$LoadSmoke)
. (Join-Path $PSScriptRoot 'common.ps1')
Import-CedarEnvironment
Assert-CedarToolchain
if (-not $env:TEST_DATABASE_URL -or $env:TEST_DATABASE_URL -notmatch '/cedar_test(\?.*)?$') { throw 'API tests may reset demo data; TEST_DATABASE_URL must target cedar_test.' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port is already occupied; no existing application will be touched." }
if (Test-Path -LiteralPath (Join-Path $CedarRoot '.local/cedar-cluster.marker')) { Start-CedarDatabase (Resolve-CedarPgBin) }
if (-not $SkipBuild) {
    Push-Location (Join-Path $CedarRoot 'backend')
    try { & '.\mvnw.cmd' -B -ntp package; Assert-CedarExit 'Backend package' } finally { Pop-Location }
}
$env:SPRING_DATASOURCE_URL = $env:TEST_DATABASE_URL
$env:SPRING_DATASOURCE_USERNAME = $env:TEST_DATABASE_USERNAME
$env:SPRING_DATASOURCE_PASSWORD = $env:TEST_DATABASE_PASSWORD
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:DATABASE_USERNAME = $env:TEST_DATABASE_USERNAME
$env:DATABASE_PASSWORD = $env:TEST_DATABASE_PASSWORD
$env:SPRING_PROFILES_ACTIVE = 'demo'
$env:SERVER_ADDRESS = '127.0.0.1'
$env:SERVER_PORT = "$Port"
$env:JOBS_ENABLED = 'true'
$env:SESSION_COOKIE_SECURE = 'false'
$env:RUN_API_TESTS = 'true'
$env:API_BASE_URL = "http://127.0.0.1:$Port"
$logs = Join-Path $CedarRoot '.logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$jar = Join-Path $CedarRoot 'backend/target/cedar-queue-1.0.0.jar'
if (-not (Test-Path -LiteralPath $jar)) { throw 'Backend artifact missing; run without -SkipBuild.' }
$process = Start-Process -FilePath (Join-Path $env:JAVA_HOME 'bin/java.exe') -ArgumentList @('-jar', ('"'+$jar+'"')) -WindowStyle Hidden -WorkingDirectory $CedarRoot -PassThru -RedirectStandardOutput (Join-Path $logs 'api-tests-server.log') -RedirectStandardError (Join-Path $logs 'api-tests-server-error.log')
try {
    $ready = $false
    for ($attempt=0;$attempt -lt 90;$attempt++) {
        if ($process.HasExited) { throw 'Test backend exited; inspect .logs/api-tests-server.log.' }
        try { $null = Invoke-RestMethod -Uri "$($env:API_BASE_URL)/api/v1/restaurant" -TimeoutSec 2; $ready=$true; break } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { throw 'Test backend startup timed out.' }
    Push-Location $CedarRoot
    try { & bun test tests/api.test.ts; Assert-CedarExit 'PostgreSQL API workflow tests'; if ($LoadSmoke) { & bun tests/load-smoke.ts; Assert-CedarExit 'Native pilot load smoke' } } finally { Pop-Location }
} finally {
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit(10000) | Out-Null }
}
