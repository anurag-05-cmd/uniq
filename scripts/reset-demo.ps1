param([string]$BaseUrl = 'http://localhost:8080', [string]$Email = 'manager@cedar.local', [string]$Password = 'CedarDemo!2026')
. (Join-Path $PSScriptRoot 'common.ps1')
$base = $BaseUrl.TrimEnd('/') + '/api/v1'
$csrf = Invoke-RestMethod -Uri "$base/auth/csrf" -SessionVariable session
$headers = @{}
$headers[$csrf.headerName] = $csrf.token
$null = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -WebSession $session -Headers $headers -ContentType 'application/x-www-form-urlencoded' -Body @{username=$Email;password=$Password}
$csrf = Invoke-RestMethod -Uri "$base/auth/csrf" -WebSession $session
$headers[$csrf.headerName] = $csrf.token
$headers['Idempotency-Key'] = [Guid]::NewGuid().ToString()
$result = Invoke-RestMethod -Uri "$base/demo/reset" -Method Post -WebSession $session -Headers $headers -ContentType 'application/json' -Body '{}'
Write-Host $result.message
