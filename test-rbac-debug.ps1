# Simplified RBAC Test - Debug version

$apiUrl = "http://localhost:4000/api"

# Login as admin
$adminLogin = Invoke-RestMethod -Uri "$apiUrl/auth/login" -Method Post -ContentType "application/json" -Body (ConvertTo-Json @{
    email = "admin@domain.com"
    password = "123456"
})
$adminToken = $adminLogin.data.accessToken
Write-Host "[OK] Admin login successful" -ForegroundColor Green

# Get stores
$stores = Invoke-RestMethod -Uri "$apiUrl/stores" -Method Get -Headers @{"Authorization" = "Bearer $adminToken"}
$store = $stores.data | Where-Object {$_.name -notmatch "Warehouse"} | Select-Object -First 1
Write-Host "[OK] Store: $($store.name)" -ForegroundColor Green

# Create ONE test user to debug
$testEmail = "test_debug_user@example.com"
$testRole = "HEAD_MANAGER"

Write-Host "`nCreating test user..." -ForegroundColor Cyan

try {
    $createBody = @{
        email = $testEmail
        fullName = "Debug User"
        roles = @($testRole)
        password = "Debug@12345"
    } | ConvertTo-Json

    Write-Host "Request body: $createBody" -ForegroundColor Gray
    
    $createResp = Invoke-RestMethod -Uri "$apiUrl/users" -Method Post `
        -Headers @{"Authorization" = "Bearer $adminToken"} `
        -ContentType "application/json" `
        -Body $createBody -ErrorAction Stop
    
    $userId = $createResp.data.id
    Write-Host "[OK] User created: $userId" -ForegroundColor Green
    
    # Try to login
    Write-Host "`nTesting login with new user..." -ForegroundColor Cyan
    $userLogin = Invoke-RestMethod -Uri "$apiUrl/auth/login" -Method Post `
        -ContentType "application/json" `
        -Body (ConvertTo-Json @{
            email = $testEmail
            password = "Debug@12345"
        }) -ErrorAction Stop
    
    $userToken = $userLogin.data.accessToken
    Write-Host "[OK] User login successful" -ForegroundColor Green
    
    # Test partners endpoint
    Write-Host "`nTesting GET /partners for $testRole..." -ForegroundColor Cyan
    try {
        $partnersResp = Invoke-RestMethod -Uri "$apiUrl/partners" -Method Get `
            -Headers @{"Authorization" = "Bearer $userToken"} -ErrorAction Stop
        Write-Host "[OK] GET /partners: $($partnersResp.data.Count) items" -ForegroundColor Green
    } catch {
        Write-Host "[FAIL] GET /partners: HTTP $($_.Exception.Response.StatusCode.Value__) - $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # Cleanup
    Write-Host "`nCleaning up..." -ForegroundColor Cyan
    Invoke-RestMethod -Uri "$apiUrl/users/$userId" -Method Delete `
        -Headers @{"Authorization" = "Bearer $adminToken"} -ErrorAction SilentlyContinue | Out-Null
    Write-Host "[OK] User deleted" -ForegroundColor Green
}
catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Full Error: $($_ | ConvertTo-Json)" -ForegroundColor Red
}

Write-Host "`n[DONE]" -ForegroundColor Green
