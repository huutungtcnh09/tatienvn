$ErrorActionPreference = "Stop"
$ApiBase = "http://localhost:4000/api"
$Email = "admin@domain.com"
$Password = "123456"

$today = (Get-Date).ToString("yyyy-MM-dd")
$invoiceNo = "PO-CHECK-" + [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$referenceId = $null
$supplierId = $null
$rebateId = $null

try {
  Write-Host "[1] Login" -ForegroundColor Cyan
  $loginResp = Invoke-RestMethod -Uri "$ApiBase/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
  $token = $loginResp.data.accessToken
  $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

  Write-Host "[2] Load data" -ForegroundColor Cyan
  $assignedStores = (Invoke-RestMethod -Uri "$ApiBase/stores/my-assigned" -Headers $headers).data
  if (-not $assignedStores -or $assignedStores.Count -eq 0) { throw "No assigned stores" }
  $storeId = $assignedStores | Where-Object { -not $_.isWarehouse } | Select-Object -First 1 | ForEach-Object { $_.id }
  if (-not $storeId) { $storeId = $assignedStores[0].id }

  $partners = (Invoke-RestMethod -Uri "$ApiBase/partners" -Headers $headers).data
  $supplier = $partners | Where-Object { $_.isSupplier -eq $true } | Select-Object -First 1
  if (-not $supplier) { throw "No supplier found" }
  $supplierId = $supplier.id

  $products = (Invoke-RestMethod -Uri "$ApiBase/products" -Headers $headers).data
  $product = $products | Select-Object -First 1
  if (-not $product) { throw "No product found" }

  Write-Host "[3] Create purchase" -ForegroundColor Cyan
  $createPayload = @{
    supplierId = $supplierId
    storeId = $storeId
    invoiceNo = $invoiceNo
    documentDate = $today
    note = "Purchase flow check"
    paidAmount = 0
    landedCost = 0
    items = @(@{ productId = $product.id; quantity = 1; unitCost = 50000 })
  } | ConvertTo-Json -Depth 6
  $createRes = Invoke-RestMethod -Uri "$ApiBase/purchases" -Method Post -Headers $headers -Body $createPayload
  $referenceId = $createRes.data.referenceId
  if (-not $referenceId) { throw "Missing referenceId" }

  $detail = (Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceId" -Headers $headers).data
  Write-Host "  savedDocumentDate=$($detail.documentDate), today=$today" -ForegroundColor Yellow

  Write-Host "[4] Create trade rebate on purchase" -ForegroundColor Cyan
  $rebatePayload = @{
    supplierId = $supplierId
    label = "Flow check trade rebate"
    amount = 1000
    note = "Flow check rebate"
  } | ConvertTo-Json
  $rebateRes = Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceId/rebates" -Method Post -Headers $headers -Body $rebatePayload
  if (-not $rebateRes.data) { throw "Create rebate failed" }
  $detailAfterRebate = (Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceId" -Headers $headers).data
  $rebates = @($detailAfterRebate.rebates)
  if (-not $rebates.Count) { throw "Created rebate not found on purchase detail" }
  $rebateIndex = $rebates.Count - 1

  Write-Host "[5] Delete rebate" -ForegroundColor Cyan
  $null = Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceId/rebates/$rebateIndex" -Method Delete -Headers $headers -Body (@{ supplierId = $supplierId } | ConvertTo-Json)

  Write-Host "=== PURCHASE FLOW CHECK PASSED ===" -ForegroundColor Green
}
finally {
  if ($referenceId -and $supplierId) {
    try {
      $voidBody = @{ supplierId = $supplierId; reason = "Cleanup purchase flow check" } | ConvertTo-Json
      $null = Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceId/void" -Method Post -Headers $headers -Body $voidBody
      Write-Host "cleanup purchase: OK" -ForegroundColor Gray
    }
    catch {
      Write-Host "cleanup purchase failed: $($_.Exception.Message)" -ForegroundColor Red
    }
  }
}
