# Smoke test for org assignment + order snapshot + KPI

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

Write-Host "`n=== Step 2: Get Users & Stores ===" -ForegroundColor Cyan
$usersResp = Invoke-RestMethod -Uri "$ApiBase/users" -Headers $headers
$storesResp = Invoke-RestMethod -Uri "$ApiBase/stores" -Headers $headers

$users = $usersResp.data
$stores = $storesResp.data

$salesPersonId = $users[0].id
$storeManagerId = $users[1].id
$storeId = $stores[0].id

Write-Host "Sales Person: $($users[0].fullName) ($salesPersonId)" -ForegroundColor Green
Write-Host "Store Manager: $($users[1].fullName) ($storeManagerId)" -ForegroundColor Green
Write-Host "Store: $($stores[0].name) ($storeId)" -ForegroundColor Green

Write-Host "`n=== Step 3: Create Org Assignment ===" -ForegroundColor Cyan
$assignmentBody = @{
    userId        = $storeManagerId
    roleType      = "STORE_MANAGER"
    storeId       = $storeId
    effectiveFrom = (Get-Date).Date.ToString("yyyy-MM-dd")
    effectiveTo   = $null
    decisionNo    = "TEST-2026-01"
    note          = "Test org assignment"
} | ConvertTo-Json

$assignmentResp = Invoke-RestMethod -Uri "$ApiBase/org-assignments" -Method Post `
  -Headers $headers -Body $assignmentBody

$assignmentId = $assignmentResp.data.id
Write-Host "Created assignment: $assignmentId" -ForegroundColor Green
Write-Host ($assignmentResp.data | ConvertTo-Json -Depth 2) -ForegroundColor Gray

Write-Host "`n=== Step 4: Create Customer ===" -ForegroundColor Cyan
$customerBody = @{
    partnerCode    = "CUST-TEST-001"
    partnerName    = "Test Customer"
    partnerType    = "CUSTOMER"
    isCustomer     = $true
    isSupplier     = $false
    email          = "customer@test.com"
    phone          = "0912345678"
} | ConvertTo-Json

$customerResp = Invoke-RestMethod -Uri "$ApiBase/partners" -Method Post `
  -Headers $headers -Body $customerBody

$customerId = $customerResp.data.id
Write-Host "Created customer: $customerId - $($customerResp.data.partnerName)" -ForegroundColor Green

Write-Host "`n=== Step 5: Create Product ===" -ForegroundColor Cyan
$productBody = @{
    productCode   = "PROD-TEST-001"
    productName   = "Test Product"
    unitId        = (Invoke-RestMethod -Uri "$ApiBase/units" -Headers $headers).data[0].id
    categoryId    = (Invoke-RestMethod -Uri "$ApiBase/categories" -Headers $headers).data[0].id
    productType   = "GOODS"
    costPrice     = 50000
    sellingPrice  = 100000
    stockQuantity = 100
} | ConvertTo-Json

$productResp = Invoke-RestMethod -Uri "$ApiBase/products" -Method Post `
  -Headers $headers -Body $productBody

$productId = $productResp.data.id
Write-Host "Created product: $productId - $($productResp.data.productName)" -ForegroundColor Green

Write-Host "`n=== Step 6: Create Sales Order with Snapshot ===" -ForegroundColor Cyan
$orderBody = @{
    customerId    = $customerId
    storeId       = $storeId
    orderDate     = (Get-Date).Date.ToString("yyyy-MM-dd")
    salesPersonId = $salesPersonId
    items         = @(
        @{
            productId   = $productId
            quantity    = 2
            unitPrice   = 100000
            discountPct = 0
        }
    )
} | ConvertTo-Json -Depth 3

$orderResp = Invoke-RestMethod -Uri "$ApiBase/sales-orders" -Method Post `
  -Headers $headers -Body $orderBody

$orderId = $orderResp.data.id
Write-Host "Created order: $orderId" -ForegroundColor Green
Write-Host "Order snapshot fields:" -ForegroundColor Gray
Write-Host "  salesPersonId: $($orderResp.data.salesPersonId)" -ForegroundColor Gray
Write-Host "  storeManagerId: $($orderResp.data.storeManagerId)" -ForegroundColor Gray
Write-Host "  storeSupervisorId: $($orderResp.data.storeSupervisorId)" -ForegroundColor Gray
Write-Host "  orgSnapshotAt: $($orderResp.data.orgSnapshotAt)" -ForegroundColor Gray

Write-Host "`n=== Step 7: Get Order Details ===" -ForegroundColor Cyan
$orderDetailResp = Invoke-RestMethod -Uri "$ApiBase/sales-orders/$orderId" -Headers $headers
Write-Host ($orderDetailResp.data | ConvertTo-Json -Depth 2) -ForegroundColor Gray

Write-Host "`n=== Step 8: Query Staff KPI (default sales_person) ===" -ForegroundColor Cyan
$kpiResp = Invoke-RestMethod -Uri "$ApiBase/dashboard/staff-kpi?timePeriod=this-year" -Headers $headers
$kpiData = $kpiResp.data
Write-Host "KPI records count: $($kpiData.Count)" -ForegroundColor Green
if ($kpiData.Count -gt 0) {
    Write-Host "First KPI record:" -ForegroundColor Gray
    Write-Host ($kpiData[0] | ConvertTo-Json) -ForegroundColor Gray
}

Write-Host "`n=== Step 9: Query Staff KPI (store_manager role) ===" -ForegroundColor Cyan
$kpiManagerResp = Invoke-RestMethod -Uri "$ApiBase/dashboard/staff-kpi?timePeriod=this-year&roleDimension=store_manager" -Headers $headers
$kpiManagerData = $kpiManagerResp.data
Write-Host "KPI records count (store_manager): $($kpiManagerData.Count)" -ForegroundColor Green
if ($kpiManagerData.Count -gt 0) {
    Write-Host "First KPI record (store_manager):" -ForegroundColor Gray
    Write-Host ($kpiManagerData[0] | ConvertTo-Json) -ForegroundColor Gray
}

Write-Host "`n=== Test Complete ===" -ForegroundColor Green
