param([switch]$Lan)
. (Join-Path $PSScriptRoot 'common.ps1')
Import-CedarEnvironment
Set-Location (Join-Path $CedarRoot 'frontend')
if ($Lan) { & bun run dev --host 0.0.0.0 } else { & bun run dev --host 127.0.0.1 }
exit $LASTEXITCODE
