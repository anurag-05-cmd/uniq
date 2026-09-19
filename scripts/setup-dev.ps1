[CmdletBinding()]
param(
    [string]$PgBin,
    [switch]$DownloadPostgres,
    [switch]$UseExistingServer,
    [string]$AdminUser = 'postgres',
    [switch]$SkipInstall
)
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $CedarRoot
Assert-CedarToolchain
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force -Path '.tools','.local','.logs' | Out-Null
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
$envText = Get-Content -LiteralPath '.env' -Raw
if ($envText -match '=change-me(\r?\n|$)') {
    $bytes = New-Object byte[] 24
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $password = [BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()
    $envText.Replace('=change-me', "=$password") | Set-Content -LiteralPath '.env' -Encoding UTF8
}
Import-CedarEnvironment
if ($DownloadPostgres -and -not (Test-Path -LiteralPath '.tools/postgresql/pgsql/bin/pg_ctl.exe')) {
    Write-Host 'Downloading official EDB PostgreSQL 18.6 Windows x64 binaries (about 365 MiB).'
    $archive = Join-Path $CedarRoot '.tools/postgresql-18.6.zip'
    if (-not (Test-Path -LiteralPath $archive)) {
        $partial = Join-Path $CedarRoot '.tools/postgresql-18.6.download'
        Invoke-WebRequest -Uri 'https://sbp.enterprisedb.com/getfile.jsp?fileid=1260566' -OutFile $partial
        Move-Item -LiteralPath $partial -Destination $archive
    }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $CedarRoot '.tools/postgresql') -Force
}
$pgTools = Resolve-CedarPgBin $PgBin
$data = Join-Path $CedarRoot '.local/pgdata'
$adminPassword = $env:PGADMIN_PASSWORD
if (-not $UseExistingServer) {
    $AdminUser = 'cedar_admin'
    $passwordFile = Join-Path $CedarRoot '.local/admin-password'
    if (-not (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION'))) {
        if ((Test-Path -LiteralPath $data) -and (Get-ChildItem -LiteralPath $data -Force | Select-Object -First 1)) { throw 'The local data directory is non-empty and is not recognized. No files were modified.' }
        $adminPassword = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
        [IO.File]::WriteAllText($passwordFile, $adminPassword)
        & (Join-Path $pgTools 'initdb.exe') -D $data -U $AdminUser --encoding=UTF8 --locale=C --auth=scram-sha-256 --pwfile=$passwordFile
        Assert-CedarExit 'Database initialization'
        @("listen_addresses = 'localhost'", "port = $($env:PGPORT)", 'max_connections = 50', "timezone = 'UTC'") | Add-Content -LiteralPath (Join-Path $data 'postgresql.conf')
        'Workspace-owned Cedar development cluster. Do not copy into version control.' | Set-Content -LiteralPath '.local/cedar-cluster.marker'
    }
    if (-not (Test-Path -LiteralPath $passwordFile)) { throw 'Workspace cluster admin credential is missing; restore .local/admin-password from your private backup.' }
    $adminPassword = (Get-Content -LiteralPath $passwordFile -Raw).Trim()
    Start-CedarDatabase $pgTools
} elseif (-not $adminPassword) {
    $credential = Get-Credential -UserName $AdminUser -Message 'Local PostgreSQL administrator credentials (used only to create Cedar databases)'
    $adminPassword = $credential.GetNetworkCredential().Password
}
if ($env:DATABASE_USERNAME -notmatch '^[a-z_][a-z0-9_]{0,62}$') { throw 'DATABASE_USERNAME must be a lowercase PostgreSQL identifier.' }
$cedarRole = $env:DATABASE_USERNAME
$cedarPasswordSql = $env:DATABASE_PASSWORD.Replace("'", "''")
$env:PGPASSWORD = $adminPassword
$psql = Join-Path $pgTools 'psql.exe'
try {
    $exists = & $psql -h $env:PGHOST -p $env:PGPORT -U $AdminUser -d postgres -At -c "SELECT 1 FROM pg_roles WHERE rolname='$cedarRole'"
    Assert-CedarExit 'PostgreSQL administrator connection'
    if ($exists -ne '1') {
        "CREATE ROLE $cedarRole LOGIN PASSWORD '$cedarPasswordSql';" | & $psql -h $env:PGHOST -p $env:PGPORT -U $AdminUser -d postgres -v ON_ERROR_STOP=1 -q
        Assert-CedarExit 'Application role creation'
    }
    foreach ($database in @('cedar','cedar_test')) {
        $exists = & $psql -h $env:PGHOST -p $env:PGPORT -U $AdminUser -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname='$database'"
        Assert-CedarExit 'Database discovery'
        if ($exists -ne '1') {
            & (Join-Path $pgTools 'createdb.exe') -h $env:PGHOST -p $env:PGPORT -U $AdminUser -O $cedarRole $database
            Assert-CedarExit "Creating $database"
        }
    }
} finally { $env:PGPASSWORD = $env:DATABASE_PASSWORD }
& $psql -h $env:PGHOST -p $env:PGPORT -U $cedarRole -d cedar -At -c 'SELECT version();'
Assert-CedarExit 'Application database connection'
if (-not $SkipInstall) {
    Push-Location (Join-Path $CedarRoot 'frontend')
    try { & bun install; Assert-CedarExit 'Frontend dependencies' } finally { Pop-Location }
    Push-Location (Join-Path $CedarRoot 'backend')
    try { & '.\mvnw.cmd' -B -ntp -DskipTests package; Assert-CedarExit 'Backend build' } finally { Pop-Location }
}
Write-Host 'Native setup complete. Flyway creates the application schema on startup.'
Write-Host 'Start: .\scripts\start-dev.ps1    Phone demo: .\scripts\start-dev.ps1 -Lan'
