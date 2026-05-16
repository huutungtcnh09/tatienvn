# Comprehensive RBAC Test - Fixed Version

$apiUrl = "http://localhost:4000/api"
$adminEmail = "admin@domain.com"
$adminPassword = "123456"

# Common password for all test users (simple, no special chars)
$testPassword = "TestPass123"

Write-Host "=== RBAC Access Control Test ===" -ForegroundColor Cyan
Write-Host "Setup phase..." -ForegroundColor Yellow

# Login as admin
$adminLogin = Invoke-RestMethod -Uri "$apiUrl/auth/login" -Method Post -ContentType "application/json" -Body (ConvertTo-Json @{
    email = $adminEmail
    password = $adminPassword
})
$adminToken = $adminLogin.data.accessToken
Write-Host "[OK] Admin authenticated" -ForegroundColor Green

# Get stores
$storesResp = Invoke-RestMethod -Uri "$apiUrl/stores" -Method Get -Headers @{"Authorization" = "Bearer $adminToken"}
$store = $storesResp.data | Where-Object {$_.name -notmatch "Warehouse"} | Select-Object -First 1
$storeId = $store.id
Write-Host "[OK] Using store: $($store.name)" -ForegroundColor Green

# Define test users
$testUsers = @(
    @{email = "rbac_head_mgr@test.local"; name = "HEAD Manager"; role = "HEAD_MANAGER"},
    @{email = "rbac_store_mgr@test.local"; name = "STORE Manager"; role = "STORE_MANAGER"},
    @{email = "rbac_sales_staff@test.local"; name = "SALES Staff"; role = "SALES_STAFF"},
    @{email = "rbac_sales_mobile@test.local"; name = "SALE Mobile"; role = "SALE_MOBILE"},
    @{email = "rbac_accountant@test.local"; name = "Accountant"; role = "ACCOUNTANT"},
    @{email = "rbac_marketing@test.local"; name = "Marketing"; role = "MARKETING"}
)

Write-Host "`nCreating test users..." -ForegroundColor Yellow
$createdUserIds = @()

foreach ($user in $testUsers) {
    try {
        $createResp = Invoke-RestMethod -Uri "$apiUrl/users" -Method Post `
            -Headers @{"Authorization" = "Bearer $adminToken"} `
            -ContentType "application/json" `
            -Body (ConvertTo-Json @{
                email = $user.email
                fullName = $user.name
                roles = @($user.role)
                password = $testPassword
            })
        
        $userId = $createResp.data.id
        $createdUserIds += $userId
        Write-Host "[OK] $($user.role): $($user.email)" -ForegroundColor Green
        
        # For store-scoped roles, assign store (with effectiveFrom = now)
        if ($user.role -in @("STORE_MANAGER", "SALES_STAFF", "SALE_MOBILE")) {
            Invoke-RestMethod -Uri "$apiUrl/org-assignments" -Method Post `
                -Headers @{"Authorization" = "Bearer $adminToken"} `
                -ContentType "application/json" `
                -Body (ConvertTo-Json @{
                    userId = $userId
                    roleType = "STORE_MANAGER"
                    storeId = $storeId
                }) -ErrorAction SilentlyContinue | Out-Null
            Write-Host "     ↳ Store assignment added" -ForegroundColor Gray
        }
    }
    catch {
        Write-Host "[FAIL] $($user.email): $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`nTesting endpoints..." -ForegroundColor Yellow

$endpoints = @{
    "head-office" = @("/dashboard/overview", "/users", "/org-positions")
    "store-pos" = @("/partners", "/categories", "/products", "/stores", "/orders", "/receipts", "/purchases")
    "mobile" = @("/products", "/partners", "/orders", "/stores", "/dashboard/overview", "/org-positions")
}

$results = @()

foreach ($user in $testUsers) {
    # Login as test user
    try {
        $userLogin = Invoke-RestMethod -Uri "$apiUrl/auth/login" -Method Post `
            -ContentType "application/json" `
            -Body (ConvertTo-Json @{
                email = $user.email
                password = $testPassword
            })
        $userToken = $userLogin.data.accessToken
    }
    catch {
        Write-Host "[FAIL] Cannot login $($user.email)" -ForegroundColor Red
        continue
    }
    
    Write-Host "`n[$($user.role)]" -ForegroundColor Yellow
    
    $roleResult = @{
        role = $user.role
        ok = 0
        denied = 0
        details = @()
    }
    
    foreach ($app in $endpoints.Keys) {
        foreach ($endpoint in $endpoints[$app]) {
            try {
                $resp = Invoke-RestMethod -Uri "$apiUrl$endpoint" -Method Get `
                    -Headers @{"Authorization" = "Bearer $userToken"} -ErrorAction Stop
                Write-Host "  [+] $endpoint" -ForegroundColor Green
                $roleResult.ok++
                $roleResult.details += "[+] [$app] $endpoint"
            }
            catch {
                $code = $_.Exception.Response.StatusCode.Value__
                Write-Host "  [-] $endpoint ($code)" -ForegroundColor Red
                $roleResult.denied++
                $roleResult.details += "[-] [$app] $endpoint ($code)"
            }
        }
    }
    
    $results += $roleResult
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

foreach ($r in $results) {
    $total = $r.ok + $r.denied
    $pct = if ($total -gt 0) { [math]::Round(($r.ok / $total) * 100, 1) } else { 0 }
    $color = if ($r.denied -eq 0) { "Green" } elseif ($r.ok -gt $total/2) { "Yellow" } else { "Red" }
    Write-Host "$($r.role): $($r.ok)/$total ($pct`%)" -ForegroundColor $color
}

Write-Host "`nCleaning up test users..." -ForegroundColor Yellow
foreach ($userId in $createdUserIds) {
    try {
        Invoke-RestMethod -Uri "$apiUrl/users/$userId" -Method Delete `
            -Headers @{"Authorization" = "Bearer $adminToken"} -ErrorAction SilentlyContinue | Out-Null
        Write-Host "[OK] Deleted: $userId" -ForegroundColor Green
    }
    catch {
        Write-Host "[WARN] Failed to delete: $userId" -ForegroundColor Yellow
    }
}

Write-Host "`n[SUCCESS] Test complete" -ForegroundColor Green
