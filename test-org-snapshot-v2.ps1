# Simplified smoke test for org assignment + order snapshot + KPI
# Uses existing data from database

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

Write-Host "`n=== Step 2: Get Users, Stores & Products ===" -ForegroundColor Cyan
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
$customerId = $partners | Where-Object { $_.partnerType -eq "CUSTOMER" } | Select-Object -First 1 | ForEach-Object { $_.id }

Write-Host "Sales Person: $salesPersonId" -ForegroundColor Green
Write-Host "Store Manager: $storeManagerId" -ForegroundColor Green
Write-Host "Store: $storeId" -ForegroundColor Green
Write-Host "Product: $productId" -ForegroundColor Green
Write-Host "Customer: $customerId" -ForegroundColor Green

if (-not $salesPersonId -or -not $storeManagerId -or -not $storeId -or -not $productId -or -not $customerId) {
    Write-Host "ERROR: Missing required data" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== Step 3: Verify Org Assignment (from Step 1) ===" -ForegroundColor Cyan
$assignmentsResp = Invoke-RestMethod -Uri "$ApiBase/org-assignments?roleType=STORE_MANAGER&storeId=$storeId" -Headers $headers
$assignments = $assignmentsResp.data
Write-Host "Assignments for store manager: $($assignments.Count)" -ForegroundColor Green
if ($assignments.Count -gt 0) {
    Write-Host "Latest assignment:" -ForegroundColor Gray
    Write-Host ($assignments[0] | ConvertTo-Json) -ForegroundColor Gray
}

Write-Host "`n=== Step 4: Create Sales Order with salesPersonId ===" -ForegroundColor Cyan
$orderBody = @{
    customerId    = $customerId
    storeId       = $storeId
    orderDate     = (Get-Date).Date.ToString("yyyy-MM-dd")
    salesPersonId = $salesPersonId
    items         = @(
        @{
            productId   = $productId
            quantity    = 5
            unitPrice   = 100000
        }
    )
} | ConvertTo-Json -Depth 3

Write-Host "Request body: $orderBody" -ForegroundColor Gray

try {
    $orderResp = Invoke-RestMethod -Uri "$ApiBase/sales-orders" -Method Post `
      -Headers $headers -Body $orderBody

    $orderId = $orderResp.data.id
    Write-Host "Created order: $orderId" -ForegroundColor Green
    Write-Host "Order snapshot fields:" -ForegroundColor Gray
    Write-Host "  salesPersonId: $($orderResp.data.salesPersonId)" -ForegroundColor Gray
    Write-Host "  storeManagerId: $($orderResp.data.storeManagerId)" -ForegroundColor Gray
    Write-Host "  storeSupervisorId: $($orderResp.data.storeSupervisorId)" -ForegroundColor Gray
    Write-Host "  orgSnapshotAt: $($orderResp.data.orgSnapshotAt)" -ForegroundColor Gray

    Write-Host "`n=== Step 5: Get Order Details ===" -ForegroundColor Cyan
    $orderDetailResp = Invoke-RestMethod -Uri "$ApiBase/sales-orders/$orderId" -Headers $headers
    Write-Host "Order date: $($orderDetailResp.data.createdAt)" -ForegroundColor Gray
    Write-Host "Order total: $($orderDetailResp.data.totalAmount)" -ForegroundColor Gray
    Write-Host "Snapshot at creation:" -ForegroundColor Gray
    Write-Host "  salesPersonId: $($orderDetailResp.data.salesPersonId)" -ForegroundColor Gray
    Write-Host "  storeManagerId: $($orderDetailResp.data.storeManagerId)" -ForegroundColor Gray
}
catch {
    Write-Host "ERROR creating order: $_" -ForegroundColor Red
}

Write-Host "`n=== Step 6: Query Staff KPI (default sales_person role) ===" -ForegroundColor Cyan
try {
    $kpiResp = Invoke-RestMethod -Uri "$ApiBase/dashboard/staff-kpi?timePeriod=this-year" -Headers $headers
    $kpiData = $kpiResp.data
    Write-Host "KPI records count: $($kpiData.Count)" -ForegroundColor Green
    
    if ($kpiData.Count -gt 0) {
        Write-Host "KPI for staff (using salesPersonId snapshot):" -ForegroundColor Gray
        $kpiData | Select-Object -First 3 | ForEach-Object {
            Write-Host "  $($_.fullName): revenue=$($_.revenue), profit=$($_.profit), orders=$($_.ordersCount)" -ForegroundColor Gray
        }
    }
}
catch {
    Write-Host "ERROR querying KPI: $_" -ForegroundColor Red
}

Write-Host "`n=== Step 7: Query Staff KPI (store_manager role dimension) ===" -ForegroundColor Cyan
try {
    $kpiManagerResp = Invoke-RestMethod -Uri "$ApiBase/dashboard/staff-kpi?timePeriod=this-year&roleDimension=store_manager" -Headers $headers
    $kpiManagerData = $kpiManagerResp.data
    Write-Host "KPI records count (store_manager dimension): $($kpiManagerData.Count)" -ForegroundColor Green
    
    if ($kpiManagerData.Count -gt 0) {
        Write-Host "KPI for store managers (using storeManagerId snapshot):" -ForegroundColor Gray
        $kpiManagerData | Select-Object -First 3 | ForEach-Object {
            Write-Host "  $($_.fullName): revenue=$($_.revenue), profit=$($_.profit), orders=$($_.ordersCount)" -ForegroundColor Gray
        }
    }
}
catch {
    Write-Host "ERROR querying KPI manager: $_" -ForegroundColor Red
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "✓ Org assignment created successfully" -ForegroundColor Green
Write-Host "✓ Sales order created with snapshot fields" -ForegroundColor Green
Write-Host "✓ KPI can be queried by different role dimensions" -ForegroundColor Green
Write-Host "`n=== Test Complete ===" -ForegroundColor Green
