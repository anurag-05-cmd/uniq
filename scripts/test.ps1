param([switch]$SkipIntegration)
. (Join-Path $PSScriptRoot 'common.ps1')
Import-CedarEnvironment
Assert-CedarToolchain
if (-not $SkipIntegration) {
    if (-not $env:TEST_DATABASE_URL -or $env:TEST_DATABASE_URL -notmatch '/cedar_test(\?.*)?$') { throw 'TEST_DATABASE_URL must target the dedicated cedar_test database.' }
    if (Test-Path -LiteralPath (Join-Path $CedarRoot '.local/cedar-cluster.marker')) { Start-CedarDatabase (Resolve-CedarPgBin) }
    $env:DATABASE_URL = $env:TEST_DATABASE_URL
    $env:DATABASE_USERNAME = $env:TEST_DATABASE_USERNAME
    $env:DATABASE_PASSWORD = $env:TEST_DATABASE_PASSWORD
    $env:SPRING_DATASOURCE_URL = $env:TEST_DATABASE_URL
    $env:SPRING_DATASOURCE_USERNAME = $env:TEST_DATABASE_USERNAME
    $env:SPRING_DATASOURCE_PASSWORD = $env:TEST_DATABASE_PASSWORD
    $env:DB_URL = $env:TEST_DATABASE_URL
    $env:DB_USER = $env:TEST_DATABASE_USERNAME
    $env:DB_PASSWORD = $env:TEST_DATABASE_PASSWORD
}
Push-Location (Join-Path $CedarRoot 'backend')
try {
    if ($SkipIntegration) { & '.\mvnw.cmd' -B -ntp test } else { & '.\mvnw.cmd' -B -ntp -Pintegration verify }
    Assert-CedarExit 'Backend tests'
} finally { Pop-Location }
Push-Location (Join-Path $CedarRoot 'frontend')
try {
    & bun run test
    Assert-CedarExit 'Frontend tests'
    & bun run build
    Assert-CedarExit 'Frontend production build'
} finally { Pop-Location }
Write-Host 'Builds and requested test suites passed.'
