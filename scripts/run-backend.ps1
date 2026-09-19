. (Join-Path $PSScriptRoot 'common.ps1')
Import-CedarEnvironment
Set-Location (Join-Path $CedarRoot 'backend')
& '.\mvnw.cmd' spring-boot:run
exit $LASTEXITCODE
