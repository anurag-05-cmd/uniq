$ErrorActionPreference = 'Stop'
$CedarRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Import-CedarEnvironment {
    $localBun = Join-Path $CedarRoot '.tools/bun/bun-windows-x64'
    if ((Test-Path -LiteralPath (Join-Path $localBun 'bun.exe')) -and $env:PATH -notlike "*$localBun*") { $env:PATH = $localBun + ';' + $env:PATH }
    $envFile = Join-Path $CedarRoot '.env'
    if (Test-Path -LiteralPath $envFile) {
        foreach ($line in Get-Content -LiteralPath $envFile) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
                $value = $Matches[2].Trim().Trim('"').Trim("'")
                [Environment]::SetEnvironmentVariable($Matches[1], $value, 'Process')
            }
        }
    }
    if ($env:SERVER_PORT -and -not $env:API_PROXY_TARGET) { $env:API_PROXY_TARGET = 'http://127.0.0.1:' + $env:SERVER_PORT }
    # Standard Spring overrides also make manual Maven invocations predictable.
    if ($env:DATABASE_URL) { $env:SPRING_DATASOURCE_URL = $env:DATABASE_URL; $env:DB_URL = $env:DATABASE_URL }
    if ($env:DATABASE_USERNAME) { $env:SPRING_DATASOURCE_USERNAME = $env:DATABASE_USERNAME; $env:DB_USER = $env:DATABASE_USERNAME }
    if ($env:DATABASE_PASSWORD) { $env:SPRING_DATASOURCE_PASSWORD = $env:DATABASE_PASSWORD; $env:DB_PASSWORD = $env:DATABASE_PASSWORD; $env:PGPASSWORD = $env:DATABASE_PASSWORD }
}

function Resolve-CedarPgBin {
    param([string]$Preferred)
    if ($Preferred -and (Test-Path -LiteralPath (Join-Path $Preferred 'pg_ctl.exe'))) { return [IO.Path]::GetFullPath($Preferred) }
    if ($env:PG_BIN -and (Test-Path -LiteralPath (Join-Path $env:PG_BIN 'pg_ctl.exe'))) { return [IO.Path]::GetFullPath($env:PG_BIN) }
    $localBin = Join-Path $CedarRoot '.tools/postgresql/pgsql/bin'
    if (Test-Path -LiteralPath (Join-Path $localBin 'pg_ctl.exe')) { return $localBin }
    $pgCommand = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
    if ($pgCommand) { return Split-Path -Parent $pgCommand.Source }
    $installed = Get-ChildItem -Path 'C:/Program Files/PostgreSQL/*/bin/pg_ctl.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($installed) { return $installed.DirectoryName }
    throw 'PostgreSQL binaries were not found. Install PostgreSQL 18 and use -PgBin, or run setup-dev.ps1 -DownloadPostgres.'
}

function Assert-CedarExit {
    param([string]$Operation)
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." }
}

function Start-CedarDatabase {
    param([string]$PgBin)
    $data = Join-Path $CedarRoot '.local/pgdata'
    if (-not (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION'))) { return }
    & (Join-Path $PgBin 'pg_ctl.exe') -D $data status 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        New-Item -ItemType Directory -Force -Path (Join-Path $CedarRoot '.logs') | Out-Null
        & (Join-Path $PgBin 'pg_ctl.exe') -D $data -l (Join-Path $CedarRoot '.logs/postgresql.log') -w start
        Assert-CedarExit 'PostgreSQL startup'
    }
}

function Get-CedarPowerShell {
    $pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if ($pwsh) { return $pwsh.Source }
    return (Get-Command powershell.exe).Source
}

function Assert-CedarToolchain {
    $localBun = Join-Path $CedarRoot '.tools/bun/bun-windows-x64'
    if (Test-Path -LiteralPath (Join-Path $localBun 'bun.exe')) { $env:PATH = $localBun + ';' + $env:PATH }
    if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) { $env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH }
    $java = Get-Command java.exe -ErrorAction SilentlyContinue
    if (-not $java) { throw 'Install Java 25, set JAVA_HOME, and add JAVA_HOME/bin to PATH.' }
    $javaText = (& $java.Source --version | Out-String)
    if ($javaText -notmatch '(?:openjdk|java)\s+25[.\s]|version\s+"25[.\"]') { throw "Java 25 is required. Active runtime: $javaText" }
    if (-not (Get-Command bun.exe -ErrorAction SilentlyContinue)) { throw 'Install Bun and open a new PowerShell session.' }
    $bunVersion = (& bun --version | Out-String).Trim()
    if ($bunVersion -notmatch '^\d+\.\d+\.\d+$' -or [version]$bunVersion -lt [version]'1.4.2') { throw "Use stable Bun 1.4.2 or newer compatible stable; found $bunVersion." }
    if (-not $env:JAVA_HOME) { $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $java.Source) }
}
