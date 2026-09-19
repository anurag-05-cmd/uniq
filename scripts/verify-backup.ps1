[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'common.ps1')
Import-CedarEnvironment
if (-not (Test-Path -LiteralPath (Join-Path $CedarRoot '.local/cedar-cluster.marker'))) { throw 'This automatic restore drill is limited to the workspace-owned development cluster.' }
$pgTools = Resolve-CedarPgBin
Start-CedarDatabase $pgTools
$database = 'cedar_restore_' + [Guid]::NewGuid().ToString('N')
$backupDirectory = Join-Path $CedarRoot '.backups'
New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
$backup = Join-Path $backupDirectory ('restore-drill-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.dump')
$adminPassword = (Get-Content -LiteralPath (Join-Path $CedarRoot '.local/admin-password') -Raw).Trim()
$psql = Join-Path $pgTools 'psql.exe'
$stopwatch = [Diagnostics.Stopwatch]::StartNew()
$created = $false
try {
    $env:PGPASSWORD = $env:DATABASE_PASSWORD
    & (Join-Path $pgTools 'pg_dump.exe') -h $env:PGHOST -p $env:PGPORT -U $env:DATABASE_USERNAME -d $env:PGDATABASE --format=custom --file=$backup
    Assert-CedarExit 'Restore drill backup'
    $countsQuery = "SELECT 'account',count(*) FROM account UNION ALL SELECT 'waitlist_entry',count(*) FROM waitlist_entry UNION ALL SELECT 'dining_visit',count(*) FROM dining_visit UNION ALL SELECT 'restaurant_table',count(*) FROM restaurant_table UNION ALL SELECT 'audit_event',count(*) FROM audit_event ORDER BY 1;"
    $sourceCounts = & $psql -h $env:PGHOST -p $env:PGPORT -U $env:DATABASE_USERNAME -d $env:PGDATABASE -At -c $countsQuery
    Assert-CedarExit 'Source integrity counts'
    $env:PGPASSWORD = $adminPassword
    & (Join-Path $pgTools 'createdb.exe') -h $env:PGHOST -p $env:PGPORT -U cedar_admin -O $env:DATABASE_USERNAME $database
    Assert-CedarExit 'Isolated restore database creation'
    $created = $true
    $env:PGPASSWORD = $env:DATABASE_PASSWORD
    & (Join-Path $pgTools 'pg_restore.exe') -h $env:PGHOST -p $env:PGPORT -U $env:DATABASE_USERNAME -d $database --no-owner --no-privileges --exit-on-error $backup
    Assert-CedarExit 'PostgreSQL restore'
    $restoredCounts = & $psql -h $env:PGHOST -p $env:PGPORT -U $env:DATABASE_USERNAME -d $database -At -c $countsQuery
    Assert-CedarExit 'Restored integrity counts'
    if (Compare-Object $sourceCounts $restoredCounts) { throw 'Counts changed during backup or restore. Stop application writers before rerunning the drill.' }
    $violations = & $psql -h $env:PGHOST -p $env:PGPORT -U $env:DATABASE_USERNAME -d $database -At -c "SELECT count(*) FROM (SELECT table_id FROM waitlist_entry WHERE status IN ('CALLED','SEATED','DINING') GROUP BY table_id HAVING count(*)>1) conflicts;"
    Assert-CedarExit 'Restored occupancy invariant'
    if ($violations -ne '0') { throw 'Restored occupancy invariant failed.' }
    $stopwatch.Stop()
    Write-Host ('Backup/restore verified in {0:N1} seconds.' -f $stopwatch.Elapsed.TotalSeconds)
    $restoredCounts | ForEach-Object { Write-Host $_ }
    Write-Host "Backup retained: $backup"
} finally {
    if ($created) {
        if ($database -notmatch '^cedar_restore_[a-f0-9]{32}$') { throw 'Unexpected restore database name; refusing cleanup.' }
        $env:PGPASSWORD = $adminPassword
        & (Join-Path $pgTools 'dropdb.exe') -h $env:PGHOST -p $env:PGPORT -U cedar_admin $database
        Assert-CedarExit 'Temporary restore database cleanup'
    }
    $env:PGPASSWORD = $env:DATABASE_PASSWORD
}
