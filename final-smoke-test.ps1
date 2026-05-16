# Simplified smoke test - fixed endpoint paths

$ApiBase = "http://localhost:4000/api"
$Email = "admin@domain.com"
$Password = "123456"

Write-Host "=== Step 1: Login ===" -ForegroundColor Cyan
$loginBody = @{
    email    = $Email
    password = $Password
} | ConvertTo-Json

$loginResp = Invoke-RestMethod -Uri "$ApiBase/auth/login" -Method Post `
  -ContentType "application/json" -Body $loginBody

$token = $loginResp.data.accessToken
Write-Host "Token: $($token.Substring(0, 20))..." -ForegroundColor Green

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}

Write-Host "=== Step 2: Get Data ===" -ForegroundColor Cyan
$usersResp = Invoke-RestMethod -Uri "$ApiBase/users" -Headers $headers
$storesResp = Invoke-RestMethod -Uri "$ApiBase/stores" -Headers $headers
$productsResp = Invoke-RestMethod -Uri "$ApiBase/products" -Headers $headers
$partnersResp = Invoke-RestMethod -Uri "$ApiBase/partners" -Headers $headers

$users = $usersResp.data
$stores = $storesResp.data
$products = $productsResp.data
$partners = $partnersResp.data

$salesPersonId = $users | Where-Object { $_.roles -match "SALES" } | Select-Object -First 1 | ForEach-Object { $_.id }
$storeManagerId = $users | Where-Object { $_.roles -match "STORE_MANAGER" } | Select-Object -First 1 | ForEach-Object { $_.id }
$storeId = $stores[0].id
$productId = $products[0].id
$customerId = $partners[0].id

Write-Host "Sales Person: $salesPersonId" -ForegroundColor Green
Write-Host "Store Manager: $storeManagerId" -ForegroundColor Green
Write-Host "Store: $storeId" -ForegroundColor Green
Write-Host "Product: $productId" -ForegroundColor Green
Write-Host "Partner: $customerId" -ForegroundColor Green

Write-Host "=== Step 3: Org Assignments ===" -ForegroundColor Cyan
$assignmentsResp = Invoke-RestMethod -Uri "$ApiBase/org-assignments?roleType=STORE_MANAGER&storeId=$storeId" -Headers $headers
$assignments = $assignmentsResp.data
Write-Host "Assignments count: $($assignments.Count)" -ForegroundColor Green

Write-Host "=== Step 4: Create Sales Order ===" -ForegroundColor Cyan
$orderBodyMap = @{
    customerId    = $customerId
    storeId       = $storeId
    paymentMethod = "CASH"
    items         = @(
        @{
            productId   = $productId
            quantity    = 5
            unitPrice   = 100000
            discountAmount = 0
            isGift = $false
        }
    )
}

if ($salesPersonId) {
    $orderBodyMap.salesPersonId = $salesPersonId
}

$orderBody = $orderBodyMap | ConvertTo-Json -Depth 4

try {
    $orderResp = Invoke-RestMethod -Uri "$ApiBase/orders" -Method Post `
      -Headers $headers -Body $orderBody

    $orderId = $orderResp.data.id
    Write-Host "Created order: $orderId" -ForegroundColor Green
    Write-Host "Snapshot salesPersonId: $($orderResp.data.salesPersonId)" -ForegroundColor Gray
    Write-Host "Snapshot storeManagerId: $($orderResp.data.storeManagerId)" -ForegroundColor Gray
}
catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
}

Write-Host "=== Step 5: Query KPI ===" -ForegroundColor Cyan
try {
    $kpiResp = Invoke-RestMethod -Uri "$ApiBase/dashboard/staff-kpi?timePeriod=this-year" -Headers $headers
    Write-Host "KPI records count: $($kpiResp.data.Count)" -ForegroundColor Green
    
    $kpiMgrResp = Invoke-RestMethod -Uri "$ApiBase/dashboard/staff-kpi?timePeriod=this-year&roleDimension=store_manager" -Headers $headers
    Write-Host "KPI records (store_manager): $($kpiMgrResp.data.Count)" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
}

Write-Host "=== Complete ===" -ForegroundColor Green
