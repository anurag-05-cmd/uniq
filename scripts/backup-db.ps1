param([string]$OutputFile)
. (Join-Path $PSScriptRoot 'common.ps1')
Import-CedarEnvironment
$pgTools = Resolve-CedarPgBin
$directory = Join-Path $CedarRoot '.backups'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
if (-not $OutputFile) { $OutputFile = Join-Path $directory ("cedar-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmmss')) }
$resolvedOutput = [IO.Path]::GetFullPath($OutputFile)
if (Test-Path -LiteralPath $resolvedOutput) { throw 'Refusing to overwrite an existing backup.' }
& (Join-Path $pgTools 'pg_dump.exe') -h $env:PGHOST -p $env:PGPORT -U $env:DATABASE_USERNAME -d $env:PGDATABASE --format=custom --file=$resolvedOutput
Assert-CedarExit 'Database backup'
Write-Host "Backup created: $resolvedOutput"
Write-Host 'Store backups securely; they contain account and queue records.'
