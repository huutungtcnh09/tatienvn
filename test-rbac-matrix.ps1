# RBAC Access Control Matrix Test
# Tests which roles can access which endpoints in each app

$apiUrl = "http://localhost:4000/api"
$adminEmail = "admin@domain.com"
$adminPassword = "123456"

# === SETUP ===
Write-Host "🔧 Setting up test environment..." -ForegroundColor Cyan

# Login as admin
$adminLogin = Invoke-RestMethod -Uri "$apiUrl/auth/login" -Method Post -ContentType "application/json" -Body (ConvertTo-Json @{
    email = $adminEmail
    password = $adminPassword
})
$adminToken = $adminLogin.data.accessToken
Write-Host "✓ Admin authenticated" -ForegroundColor Green

# Get stores list
$storesResp = Invoke-RestMethod -Uri "$apiUrl/stores" -Method Get -Headers @{"Authorization" = "Bearer $adminToken"}
$testStore = $storesResp.data | Where-Object { $_.name -notmatch "Warehouse" } | Select-Object -First 1
$storeId = $testStore.id
Write-Host "✓ Using store: $($testStore.name)" -ForegroundColor Green

# === CREATE TEST USERS ===
Write-Host "`n👥 Creating test users..." -ForegroundColor Cyan

$testUsers = @(
    @{ email = "test_head@example.com"; name = "HEAD_MANAGER Test"; role = "HEAD_MANAGER" },
    @{ email = "test_store@example.com"; name = "STORE_MANAGER Test"; role = "STORE_MANAGER" },
    @{ email = "test_sales@example.com"; name = "SALES_STAFF Test"; role = "SALES_STAFF" },
    @{ email = "test_mobile@example.com"; name = "SALE_MOBILE Test"; role = "SALE_MOBILE" },
    @{ email = "test_acct@example.com"; name = "ACCOUNTANT Test"; role = "ACCOUNTANT" },
    @{ email = "test_mkt@example.com"; name = "MARKETING Test"; role = "MARKETING" }
)

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
                password = "Test@123456"
            })
        
        $userId = $createResp.data.id
        $createdUserIds += $userId
        Write-Host "✓ Created: $($user.email)" -ForegroundColor Green
        
        # Assign store for store-scoped roles
        if ($user.role -in @("STORE_MANAGER", "SALES_STAFF", "SALE_MOBILE")) {
            Invoke-RestMethod -Uri "$apiUrl/org-assignments" -Method Post `
                -Headers @{"Authorization" = "Bearer $adminToken"} `
                -ContentType "application/json" `
                -Body (ConvertTo-Json @{
                    userId = $userId
                    storeId = $storeId
                }) | Out-Null
            Write-Host "  → Assigned to store" -ForegroundColor Gray
        }
    }
    catch {
        Write-Host "✗ Failed: $($user.email) - $($_.Exception.Message)" -ForegroundColor Red
    }
}

# === TEST ENDPOINTS ===
Write-Host "`n📊 Testing endpoint access..." -ForegroundColor Cyan

$endpoints = @{
    "head-office" = @("/dashboard/overview", "/users", "/org-positions", "/rbac")
    "store-pos" = @("/partners", "/categories", "/products", "/stores", "/orders", "/receipts", "/purchases")
    "mobile" = @("/products", "/partners", "/orders", "/stores", "/dashboard/overview", "/org-positions")
}

$accessMatrix = @()

foreach ($user in $testUsers) {
    # Login as test user
    try {
        $userLogin = Invoke-RestMethod -Uri "$apiUrl/auth/login" -Method Post `
            -ContentType "application/json" `
            -Body (ConvertTo-Json @{
                email = $user.email
                password = "Test@123456"
            })
        $userToken = $userLogin.data.accessToken
    }
    catch {
        Write-Host "✗ Failed to login as $($user.email)" -ForegroundColor Red
        continue
    }
    
    Write-Host "`n$($user.role):" -ForegroundColor Yellow
    
    $roleMatrix = @{
        role = $user.role
        apps = @{}
    }
    
    foreach ($app in $endpoints.Keys) {
        $appResult = @{
            name = $app
            accessible = @()
            blocked = @()
        }
        
        foreach ($endpoint in $endpoints[$app]) {
            try {
                $response = Invoke-RestMethod -Uri "$apiUrl$endpoint" -Method Get `
                    -Headers @{"Authorization" = "Bearer $userToken"} -ErrorAction Stop
                Write-Host "  ✓ [$app] $endpoint" -ForegroundColor Green
                $appResult.accessible += $endpoint
            }
            catch {
                $statusCode = $_.Exception.Response.StatusCode.Value__
                Write-Host "  ✗ [$app] $endpoint (HTTP $statusCode)" -ForegroundColor Red
                $appResult.blocked += @{
                    endpoint = $endpoint
                    status = $statusCode
                }
            }
        }
        
        $roleMatrix.apps[$app] = $appResult
    }
    
    $accessMatrix += $roleMatrix
}

# === GENERATE REPORT ===
Write-Host "`n`n" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "           RBAC ACCESS CONTROL VERIFICATION REPORT" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

foreach ($entry in $accessMatrix) {
    Write-Host "`n📋 Role: $($entry.role)" -ForegroundColor Yellow
    
    foreach ($app in $entry.apps.Keys) {
        $data = $entry.apps[$app]
        $totalEndpoints = $data.accessible.Count + $data.blocked.Count
        $accessPercent = [math]::Round(($data.accessible.Count / $totalEndpoints) * 100, 1)
        
        $statusColor = if ($data.blocked.Count -eq 0) { "Green" } elseif ($accessPercent -ge 50) { "Yellow" } else { "Red" }
        Write-Host "  $app: $($data.accessible.Count)/$totalEndpoints ($accessPercent%)" -ForegroundColor $statusColor
        
        foreach ($ep in $data.accessible) {
            Write-Host "    ✓ $ep" -ForegroundColor Green
        }
        foreach ($blocked in $data.blocked) {
            Write-Host "    ✗ $($blocked.endpoint) [HTTP $($blocked.status)]" -ForegroundColor Red
        }
    }
}

# === SUMMARY ===
Write-Host "`n" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "                    SUMMARY" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

$summary = @()
foreach ($entry in $accessMatrix) {
    $totalAccess = 0
    $totalBlocked = 0
    
    foreach ($app in $entry.apps.Keys) {
        $data = $entry.apps[$app]
        $totalAccess += $data.accessible.Count
        $totalBlocked += $data.blocked.Count
    }
    
    $statusColor = if ($totalBlocked -eq 0) { "Green" } else { "Yellow" }
    Write-Host "$($entry.role): $totalAccess accessible, $totalBlocked blocked" -ForegroundColor $statusColor
    
    $summary += @{
        role = $entry.role
        accessible = $totalAccess
        blocked = $totalBlocked
    }
}

# === CLEANUP ===
Write-Host "`n🗑️ Cleaning up test users..." -ForegroundColor Cyan
foreach ($userId in $createdUserIds) {
    try {
        Invoke-RestMethod -Uri "$apiUrl/users/$userId" -Method Delete `
            -Headers @{"Authorization" = "Bearer $adminToken"} `
            -ErrorAction SilentlyContinue | Out-Null
        Write-Host "✓ Deleted test user: $userId" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ Failed to delete user $userId" -ForegroundColor Red
    }
}

Write-Host "`n✅ RBAC verification complete!" -ForegroundColor Green

# === JSON OUTPUT ===
$report = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    store = @{
        id = $storeId
        name = $testStore.name
    }
    summary = $summary
    details = $accessMatrix
}

Write-Host "`n📄 Detailed Report (JSON):" -ForegroundColor Cyan
$report | ConvertTo-Json -Depth 5 | Write-Host
