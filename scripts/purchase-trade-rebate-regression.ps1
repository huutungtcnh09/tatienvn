$ErrorActionPreference = "Stop"
$ApiBase = "http://localhost:4000/api"
$Email = "admin@domain.com"
$Password = "123456"

$today = (Get-Date).ToString("yyyy-MM-dd")
$invoiceNo = "PO-TRADE-REG-" + [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$referenceId = $null
$supplierId = $null
$rebateId = $null

try {
  Write-Host "[1] Login" -ForegroundColor Cyan
  $loginResp = Invoke-RestMethod -Uri "$ApiBase/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
  $token = $loginResp.data.accessToken
  $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

  Write-Host "[2] Load scope data" -ForegroundColor Cyan
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

  Write-Host "[3] Create purchase with today's documentDate" -ForegroundColor Cyan
  $createPayload = @{
    supplierId = $supplierId
    storeId = $storeId
    invoiceNo = $invoiceNo
    documentDate = $today
    note = "Trade rebate regression"
    paidAmount = 0
    landedCost = 0
    items = @(@{ productId = $product.id; quantity = 2; unitCost = 90000 })
  } | ConvertTo-Json -Depth 6

  $createRes = Invoke-RestMethod -Uri "$ApiBase/purchases" -Method Post -Headers $headers -Body $createPayload
  $referenceId = $createRes.data.referenceId
  if (-not $referenceId) { throw "Create purchase failed: missing referenceId" }

  $detail = (Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceId" -Headers $headers).data
  Write-Host "  create.documentDate=$($createRes.data.documentDate), detail.documentDate=$($detail.documentDate), today=$today" -ForegroundColor Yellow
  if ($detail.documentDate -ne $today) {
    throw "Date mismatch: detail.documentDate=$($detail.documentDate), expected=$today"
  }

  Write-Host "[4] Create TRADE_REBATE" -ForegroundColor Cyan
  $tradeRebatePayload = @{
    supplierId = $supplierId
    label = "Trade rebate regression"
    amount = 1000
    note = "Trade rebate regression"
  } | ConvertTo-Json

  $tradeRebateRes = Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceId/rebates" -Method Post -Headers $headers -Body $tradeRebatePayload
  $rebateData = $tradeRebateRes.data
  if (-not $rebateData) { throw "Create TRADE_REBATE failed: missing response data" }

  $detailAfterRebate = (Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceId" -Headers $headers).data
  $createdRebate = $detailAfterRebate.rebates | Select-Object -Last 1
  if (-not $createdRebate) { throw "Created TRADE_REBATE not found on purchase detail" }
  $rebateIndex = [Math]::Max(($detailAfterRebate.rebates | Measure-Object).Count - 1, 0)
  Write-Host "  rebateAmount=$($detailAfterRebate.rebateAmount)" -ForegroundColor Green

  Write-Host "[5] Delete TRADE_REBATE" -ForegroundColor Cyan
  $deleteBody = @{ supplierId = $supplierId } | ConvertTo-Json
  $null = Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceId/rebates/$rebateIndex" -Method Delete -Headers $headers -Body $deleteBody

  Write-Host "=== TRADE REBATE REGRESSION PASSED ===" -ForegroundColor Green
}
finally {
  if ($referenceId -and $supplierId) {
    try {
      $voidBody = @{ supplierId = $supplierId; reason = "Cleanup trade rebate regression" } | ConvertTo-Json
      $null = Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceId/void" -Method Post -Headers $headers -Body $voidBody
      Write-Host "cleanup purchase: OK" -ForegroundColor Gray
    }
    catch {
      Write-Host "cleanup purchase failed: $($_.Exception.Message)" -ForegroundColor Red
    }
  }
}
