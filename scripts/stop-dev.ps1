param([switch]$Database)
. (Join-Path $PSScriptRoot 'common.ps1')
Import-CedarEnvironment
$processFile = Join-Path $CedarRoot '.logs/processes.json'
function Stop-CedarProcessTree([int]$ProcessId) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) { Stop-CedarProcessTree $child.ProcessId }
    Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $processFile) {
    $record = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
    if ($record.root -ne $CedarRoot) { throw 'Process record belongs to a different workspace.' }
    foreach ($name in @('backend','frontend')) {
        $processId = [int]$record.$name
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        $expected = Join-Path $CedarRoot "scripts/run-$name.ps1"
        if ($process -and $process.CommandLine.Contains($expected)) { Stop-CedarProcessTree $processId }
    }
    Remove-Item -LiteralPath $processFile
}
if ($Database -and (Test-Path -LiteralPath (Join-Path $CedarRoot '.local/cedar-cluster.marker'))) {
    & (Join-Path (Resolve-CedarPgBin) 'pg_ctl.exe') -D (Join-Path $CedarRoot '.local/pgdata') -m fast -w stop
    Assert-CedarExit 'PostgreSQL shutdown'
}
Write-Host 'Development application processes stopped.'
