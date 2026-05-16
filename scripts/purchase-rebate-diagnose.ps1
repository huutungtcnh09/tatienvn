param(
  [Parameter(Mandatory = $true)]
  [string]$ReferenceId,
  [string]$ApiBase = "http://localhost:4000/api",
  [string]$Email = "admin@domain.com",
  [string]$Password = "123456"
)

$ErrorActionPreference = "Stop"

function To-Num([object]$v) {
  if ($null -eq $v -or $v -eq "") { return 0.0 }
  return [double]$v
}

function To-I([object]$v) {
  return [int]([math]::Round((To-Num $v), 0))
}

$login = Invoke-RestMethod -Uri "$ApiBase/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
$token = $login.data.accessToken
$headers = @{ Authorization = "Bearer $token" }

$detail = (Invoke-RestMethod -Uri "$ApiBase/purchases/$ReferenceId" -Headers $headers).data
if (-not $detail) { throw "Purchase not found: $ReferenceId" }

$sumLine = 0.0
$sumAlloc = 0.0
$sumQty = 0.0
$sumRebateAlloc = 0.0
$sumNetFinal = 0.0

$rows = @()
foreach ($it in @($detail.items)) {
  $qty = To-Num $it.quantity
  $lineAmount = if ($it.lineAmount -ne $null) { To-Num $it.lineAmount } else { $qty * (To-Num $it.unitCost) }
  $alloc = To-Num $it.allocatedLandedCost
  $rebAlloc = To-Num $it.rebateAllocatedAmount
  $netFinal = if ($it.netFinalAmount -ne $null) { To-Num $it.netFinalAmount } else { (To-Num $it.netAmount) - $rebAlloc }
  $expectedUnitFinal = if ($qty -gt 0) { $netFinal / $qty } else { 0 }

  $sumLine += $lineAmount
  $sumAlloc += $alloc
  $sumQty += $qty
  $sumRebateAlloc += $rebAlloc
  $sumNetFinal += $netFinal

  $rows += [PSCustomObject]@{
    product = $it.productName
    qty = To-I $qty
    unitCost = To-I $it.unitCost
    lineAmount = To-I $lineAmount
    allocatedLandedCost = To-I $alloc
    rebateAllocatedAmount = To-I $rebAlloc
    unitFinalCost_API = To-I $it.unitFinalCost
    unitFinalCost_FromFormula = To-I $expectedUnitFinal
    netFinalAmount = To-I $netFinal
  }
}

$expectedDocAmount = [math]::Max($sumLine + $sumAlloc - (To-Num $detail.rebateAmount), 0)

Write-Host "=== PURCHASE REBATE DIAGNOSE ===" -ForegroundColor Cyan
Write-Host ((@{
  referenceId = $detail.referenceId
  amount_API = To-I $detail.amount
  amount_Expected = To-I $expectedDocAmount
  lineAmount_Sum = To-I $sumLine
  landedCost_API = To-I $detail.landedCost
  landedCost_SumItems = To-I $sumAlloc
  rebateAmount_API = To-I $detail.rebateAmount
  rebateInventoryAdjustment_API = To-I $detail.rebateInventoryAdjustment
  rebateAllocatedAmount_SumItems = To-I $sumRebateAlloc
  netFinalAmount_SumItems = To-I $sumNetFinal
} | ConvertTo-Json -Compress))

$rows | Format-Table -AutoSize | Out-String | Write-Host

if ([math]::Round((To-Num $detail.amount), 2) -ne [math]::Round($expectedDocAmount, 2)) {
  Write-Host "Mismatch detected: amount_API != amount_Expected" -ForegroundColor Red
  exit 2
}

Write-Host "No amount mismatch detected for this purchase." -ForegroundColor Green
