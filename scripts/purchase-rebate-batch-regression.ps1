$ErrorActionPreference = "Stop"
$ApiBase = "http://localhost:4000/api"
$Email = "admin@domain.com"
$Password = "123456"

$today = (Get-Date).ToString("yyyy-MM-dd")
$supplierId = $null
$storeId = $null
$referenceIdA = $null
$referenceIdB = $null
$batchReferenceId = $null
$directRebateIndex = -1

function Assert-Equal {
  param(
    [string]$Name,
    $Actual,
    $Expected
  )

  if ($Actual -ne $Expected) {
    throw "$Name mismatch. Expected=$Expected, Actual=$Actual"
  }
}

function New-Purchase {
  param(
    [hashtable]$Headers,
    [string]$SupplierId,
    [string]$StoreId,
    [string]$InvoiceNo,
    [string]$DocumentDate,
    [string]$ProductId
  )

  $payload = @{
    supplierId = $SupplierId
    storeId = $StoreId
    invoiceNo = $InvoiceNo
    documentDate = $DocumentDate
    note = "Rebate batch regression"
    paidAmount = 0
    landedCostKind = "TRANSPORT"
    landedCost = 0
    items = @(
      @{ productId = $ProductId; quantity = 1; unitCost = 200000 }
    )
  } | ConvertTo-Json -Depth 6

  $res = Invoke-RestMethod -Uri "$ApiBase/purchases" -Method Post -Headers $Headers -Body $payload
  if (-not $res.data.referenceId) {
    throw "Failed to create purchase"
  }
  return $res.data.referenceId
}

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

  $products = @((Invoke-RestMethod -Uri "$ApiBase/products" -Headers $headers).data | Select-Object -First 1)
  if ($products.Count -lt 1) { throw "Need at least 1 product" }
  $productId = $products[0].id

  Write-Host "[3] Create 2 purchase documents" -ForegroundColor Cyan
  $referenceIdA = New-Purchase -Headers $headers -SupplierId $supplierId -StoreId $storeId -InvoiceNo ("PO-BATCH-A-" + [DateTimeOffset]::Now.ToUnixTimeMilliseconds()) -DocumentDate $today -ProductId $productId
  $referenceIdB = New-Purchase -Headers $headers -SupplierId $supplierId -StoreId $storeId -InvoiceNo ("PO-BATCH-B-" + [DateTimeOffset]::Now.ToUnixTimeMilliseconds()) -DocumentDate $today -ProductId $productId

  Write-Host "[4] Create one rebate document (reduce payable + recalc cost for selected POs)" -ForegroundColor Cyan
  $purchaseAmountA = 200000
  $purchaseAmountB = 200000
  $directRebateAmount = 50000
  $directRebatePayload = @{
    supplierId = $supplierId
    label = "Rebate document regression"
    amount = $directRebateAmount
    note = "One-document rebate regression"
    referenceIds = @(
      $referenceIdA,
      $referenceIdB
    )
  } | ConvertTo-Json -Depth 6

  $createRes = Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceIdA/rebates" -Method Post -Headers $headers -Body $directRebatePayload
  Assert-Equal "Create rebate targetCount" ([int]$createRes.data.targetCount) 2

  Write-Host "[5] Verify payable and cost behavior" -ForegroundColor Cyan
  $detailA = (Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceIdA" -Headers $headers).data
  $detailB = (Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceIdB" -Headers $headers).data

  Assert-Equal "PO-A rebate row count = 1" $detailA.rebates.Count 1
  Assert-Equal "PO-B rebate row count = 0" $detailB.rebates.Count 0

  $batchTotalAmount = $directRebateAmount
  $amountBaseTotal = $purchaseAmountA + $purchaseAmountB
  $expectedA = [int]([math]::Round($batchTotalAmount * ($purchaseAmountA / $amountBaseTotal), 0))
  $expectedB = [int]($batchTotalAmount - $expectedA)

  $directRebate = @($detailA.rebates) | Select-Object -First 1
  Assert-Equal "PO-A direct rebate amount" ([int]([math]::Round([double]$directRebate.amount))) $directRebateAmount
  Assert-Equal "PO-A payable rebateAmount" ([int]([math]::Round([double]$detailA.rebateAmount))) $directRebateAmount
  Assert-Equal "PO-B payable rebateAmount" ([int]([math]::Round([double]$detailB.rebateAmount))) 0

  # [5a] COGS cost allocation: items chưa bán → COGS adj = 0, inventory adj = expectedA/B
  Assert-Equal "PO-A rebateCogsAdjustment=0 (chua ban)" ([int]([math]::Round([double]$detailA.rebateCogsAdjustment))) 0
  Assert-Equal "PO-B rebateCogsAdjustment=0 (chua ban)" ([int]([math]::Round([double]$detailB.rebateCogsAdjustment))) 0
  Assert-Equal "PO-A rebateInventoryAdjustment (batch)" ([int]([math]::Round([double]$detailA.rebateInventoryAdjustment))) $expectedA
  Assert-Equal "PO-B rebateInventoryAdjustment (batch)" ([int]([math]::Round([double]$detailB.rebateInventoryAdjustment))) $expectedB
  Assert-Equal "Sum inventoryAdjustment A+B = batch total" ([int]([math]::Round([double]$detailA.rebateInventoryAdjustment + [double]$detailB.rebateInventoryAdjustment))) $batchTotalAmount

  # [5b] costOnlyRebateAmount (áp dụng theo phân bổ nội bộ)
  Assert-Equal "PO-A costOnlyRebateAmount" ([int]([math]::Round([double]$detailA.costOnlyRebateAmount))) $expectedA
  Assert-Equal "PO-B costOnlyRebateAmount" ([int]([math]::Round([double]$detailB.costOnlyRebateAmount))) $expectedB

  # [5c] totalRebateAmount
  Assert-Equal "PO-A totalRebateAmount (single row)" ([int]([math]::Round([double]$detailA.totalRebateAmount))) $directRebateAmount
  Assert-Equal "PO-B totalRebateAmount (no row)" ([int]([math]::Round([double]$detailB.totalRebateAmount))) 0

  # [6d] Effective amount = grossAmount - payableRebate (batch không ảnh hưởng payable)
  $grossA = 200000
  $grossB = 200000
  Assert-Equal "PO-A amount (gross - direct rebate)" ([int]([math]::Round([double]$detailA.amount))) ($grossA - $directRebateAmount)
  Assert-Equal "PO-B amount unchanged" ([int]([math]::Round([double]$detailB.amount))) $grossB

  # [5e] Per-rebate entry
  Assert-Equal "Direct PO-A affectsPayable=true" ([bool]$directRebate.affectsPayable) $true
  Assert-Equal "Direct PO-A payableImpactAmount" ([int]([math]::Round([double]$directRebate.payableImpactAmount))) $directRebateAmount
  Assert-Equal "Direct PO-A costAllocationAmount=0" ([int]([math]::Round([double]$directRebate.costAllocationAmount))) 0

  Write-Host "[6] Delete rebate document and verify rollback" -ForegroundColor Cyan
  $deletePayload = @{ supplierId = $supplierId } | ConvertTo-Json
  $null = Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceIdA/rebates/0" -Method Delete -Headers $headers -Body $deletePayload

  $detailAAfter = (Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceIdA" -Headers $headers).data
  $detailBAfter = (Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceIdB" -Headers $headers).data

  $stillA = @($detailAAfter.rebates)
  $stillB = @($detailBAfter.rebates)
  Assert-Equal "PO-A remaining batch rebates" $stillA.Count 0
  Assert-Equal "PO-B remaining batch rebates" $stillB.Count 0
  Assert-Equal "PO-A total rebate after rollback" ([int]([math]::Round([double]$detailAAfter.rebateAmount))) 0
  Assert-Equal "PO-B total rebate after rollback" ([int]([math]::Round([double]$detailBAfter.rebateAmount))) 0

  # [7b] Numeric assertions sau rollback: inventory adj về 0, amount phục hồi
  Assert-Equal "PO-A rebateCogsAdjustment sau rollback" ([int]([math]::Round([double]$detailAAfter.rebateCogsAdjustment))) 0
  Assert-Equal "PO-B rebateCogsAdjustment sau rollback" ([int]([math]::Round([double]$detailBAfter.rebateCogsAdjustment))) 0
  Assert-Equal "PO-A rebateInventoryAdjustment sau rollback" ([int]([math]::Round([double]$detailAAfter.rebateInventoryAdjustment))) 0
  Assert-Equal "PO-B rebateInventoryAdjustment sau rollback" ([int]([math]::Round([double]$detailBAfter.rebateInventoryAdjustment))) 0
  Assert-Equal "PO-A totalRebateAmount sau rollback" ([int]([math]::Round([double]$detailAAfter.totalRebateAmount))) 0
  Assert-Equal "PO-B totalRebateAmount sau rollback" ([int]([math]::Round([double]$detailBAfter.totalRebateAmount))) 0
  Assert-Equal "PO-A amount phuc hoi (bang gross)" ([int]([math]::Round([double]$detailAAfter.amount))) $grossA
  Assert-Equal "PO-B amount khong doi sau rollback" ([int]([math]::Round([double]$detailBAfter.amount))) $grossB

  Write-Host "=== REBATE ONE-DOCUMENT REGRESSION PASSED ===" -ForegroundColor Green

  # [8] Kiểm tra: chiết khấu đơn lẻ (chỉ PO hiện tại) → chỉ tạo 1 bản ghi purchase_rebate
  Write-Host "[8] Verify single-PO rebate creates exactly 1 record" -ForegroundColor Cyan
  $singleReferenceId = New-Purchase -Headers $headers -SupplierId $supplierId -StoreId $storeId -InvoiceNo ("PO-SINGLE-" + [DateTimeOffset]::Now.ToUnixTimeMilliseconds()) -DocumentDate $today -ProductId $productId
  $singleRebateAmount = 6000000
  $singleRebatePayload = @{
    supplierId = $supplierId
    label = "Chiết khấu thương mại"
    amount = $singleRebateAmount
    note = ""
  } | ConvertTo-Json -Depth 6
  $null = Invoke-RestMethod -Uri "$ApiBase/purchases/$singleReferenceId/rebates" -Method Post -Headers $headers -Body $singleRebatePayload
  $singleDetail = (Invoke-RestMethod -Uri "$ApiBase/purchases/$singleReferenceId" -Headers $headers).data
  Assert-Equal "Single rebate record count = 1" $singleDetail.rebates.Count 1
  Assert-Equal "Single rebate amount = 6M" ([int]([math]::Round([double]$singleDetail.rebates[0].amount))) $singleRebateAmount
  Assert-Equal "Single rebate payable reduced" ([int]([math]::Round([double]$singleDetail.rebateAmount))) $singleRebateAmount
  Assert-Equal "Single rebate affects payable=true" ([bool]$singleDetail.rebates[0].affectsPayable) $true
  # Cleanup single PO
  try {
    $null = Invoke-RestMethod -Uri "$ApiBase/purchases/$singleReferenceId/void" -Method Post -Headers $headers -Body (@{ supplierId = $supplierId; reason = "Cleanup single rebate test" } | ConvertTo-Json)
  } catch {}

  Write-Host "=== ALL REBATE REGRESSION PASSED ===" -ForegroundColor Green
}
finally {
  if ($referenceIdA -and $supplierId) {
    try {
      $voidBodyA = @{ supplierId = $supplierId; reason = "Cleanup rebate batch regression A" } | ConvertTo-Json
      $null = Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceIdA/void" -Method Post -Headers $headers -Body $voidBodyA
      Write-Host "cleanup purchase A: OK" -ForegroundColor Gray
    }
    catch {
      Write-Host "cleanup purchase A failed: $($_.Exception.Message)" -ForegroundColor Red
    }
  }

  if ($referenceIdB -and $supplierId) {
    try {
      $voidBodyB = @{ supplierId = $supplierId; reason = "Cleanup rebate batch regression B" } | ConvertTo-Json
      $null = Invoke-RestMethod -Uri "$ApiBase/purchases/$referenceIdB/void" -Method Post -Headers $headers -Body $voidBodyB
      Write-Host "cleanup purchase B: OK" -ForegroundColor Gray
    }
    catch {
      Write-Host "cleanup purchase B failed: $($_.Exception.Message)" -ForegroundColor Red
    }
  }
}
