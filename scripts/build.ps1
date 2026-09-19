. (Join-Path $PSScriptRoot 'common.ps1')
Import-CedarEnvironment
Assert-CedarToolchain
Push-Location (Join-Path $CedarRoot 'frontend')
try {
    & bun install --frozen-lockfile
    Assert-CedarExit 'Frontend dependency verification'
    & bun run build
    Assert-CedarExit 'Frontend production build'
} finally { Pop-Location }
Push-Location (Join-Path $CedarRoot 'backend')
try {
    & '.\mvnw.cmd' -B -ntp package
    Assert-CedarExit 'Backend production build'
} finally { Pop-Location }
Write-Host 'Artifacts: frontend/dist and backend/target/cedar-queue-1.0.0.jar'
