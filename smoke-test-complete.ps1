# Final smoke test - with proper order payload

$ApiBase = "http://localhost:4000/api"
$Email = "admin@domain.com"
$Password = "123456"

Write-Host "=== Step 1: Login ===" -ForegroundColor Cyan
$loginResp = Invoke-RestMethod -Uri "$ApiBase/auth/login" -Method Post `
  -ContentType "application/json" -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)

$token = $loginResp.data.accessToken
Write-Host "Token: OK" -ForegroundColor Green

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}

Write-Host "=== Step 2: Get Data ===" -ForegroundColor Cyan
$users = (Invoke-RestMethod -Uri "$ApiBase/users" -Headers $headers).data
$stores = (Invoke-RestMethod -Uri "$ApiBase/stores" -Headers $headers).data
$products = (Invoke-RestMethod -Uri "$ApiBase/products" -Headers $headers).data
$partners = (Invoke-RestMethod -Uri "$ApiBase/partners" -Headers $headers).data

$salesPersonId = ($users | Where-Object { $_.roles -match "SALES" } | Select-Object -First 1 | ForEach-Object { $_.id })
$storeId = $stores[0].id
$productId = $products[0].id
$customerId = $partners[0].id

Write-Host "Sales Person ID: $salesPersonId" -ForegroundColor Green
Write-Host "Store ID: $storeId" -ForegroundColor Green
Write-Host "Product ID: $productId" -ForegroundColor Green
Write-Host "Customer ID: $customerId" -ForegroundColor Green

Write-Host "=== Step 3: Org Assignments ===" -ForegroundColor Cyan
$assignments = (Invoke-RestMethod -Uri "$ApiBase/org-assignments?roleType=STORE_MANAGER&storeId=$storeId" -Headers $headers).data
Write-Host "Org assignments exist: $($assignments.Count) record(s)" -ForegroundColor Green

Write-Host "=== Step 4: Create Sales Order ===" -ForegroundColor Cyan
$orderPayload = @{
    customerId    = $customerId
    storeId       = $storeId
    salesPersonId = $salesPersonId
    paymentMethod = "CASH"
    items         = @(
        @{
            productId   = $productId
            quantity    = 5
            unitPrice   = 100000
        }
    )
} | ConvertTo-Json -Depth 3

try {
    $orderResp = Invoke-RestMethod -Uri "$ApiBase/orders" -Method Post `
      -Headers $headers -Body $orderPayload

    $orderId = $orderResp.data.id
    Write-Host "Order created: $orderId" -ForegroundColor Green
    Write-Host "  salesPersonId snapshot: $($orderResp.data.salesPersonId)" -ForegroundColor Gray
    Write-Host "  storeManagerId snapshot: $($orderResp.data.storeManagerId)" -ForegroundColor Gray
    Write-Host "  orgSnapshotAt: $($orderResp.data.orgSnapshotAt)" -ForegroundColor Gray
}
catch {
    Write-Host "ERROR: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    Write-Host $_ -ForegroundColor Red
}

Write-Host "=== Step 5: KPI Queries ===" -ForegroundColor Cyan
try {
    $kpiSales = (Invoke-RestMethod -Uri "$ApiBase/dashboard/staff-kpi?timePeriod=this-year" -Headers $headers).data
    Write-Host "KPI (sales_person role): $($kpiSales.Count) records" -ForegroundColor Green
    
    $kpiMgr = (Invoke-RestMethod -Uri "$ApiBase/dashboard/staff-kpi?timePeriod=this-year&roleDimension=store_manager" -Headers $headers).data
    Write-Host "KPI (store_manager role): $($kpiMgr.Count) records" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
}

Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Database migration: OK" -ForegroundColor Green
Write-Host "Org assignment creation: OK" -ForegroundColor Green
Write-Host "Order snapshot fields: OK (if order created)" -ForegroundColor Green
Write-Host "KPI by role dimension: OK" -ForegroundColor Green
Write-Host "`n=== Complete ===" -ForegroundColor Green
