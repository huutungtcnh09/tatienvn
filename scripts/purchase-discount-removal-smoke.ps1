param(
  [string]$BaseUrl = "http://localhost:4000",
  [string]$Email = "admin@domain.com"
)

$ErrorActionPreference = "Stop"

function Get-AccessToken {
  $password = if ($env:APP_KD_SMOKE_PASSWORD) { $env:APP_KD_SMOKE_PASSWORD } else { "123456" }
  $loginBody = @{ email = $Email; password = $password } | ConvertTo-Json
  $loginRes = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -ContentType "application/json" -Body $loginBody
  return $loginRes.data.accessToken
}

function Assert-NoLegacyField {
  param(
    [Parameter(Mandatory = $true)]$Object,
    [Parameter(Mandatory = $true)][string[]]$Fields,
    [Parameter(Mandatory = $true)][string]$Scope
  )

  if ($null -eq $Object) {
    throw "[$Scope] object is null"
  }

  $names = @($Object.PSObject.Properties.Name)
  foreach ($f in $Fields) {
    if ($names -contains $f) {
      throw "[$Scope] legacy field detected: $f"
    }
  }
}

$legacyFields = @("purchaseDiscount", "lineDiscount", "allocatedDocDiscount", "discountAmount", "paymentDiscountAmount", "lineDiscountAmount", "purchaseDiscountAmount")

Write-Output "=== Purchase discount removal smoke test ==="
$token = Get-AccessToken
$headers = @{ Authorization = "Bearer $token" }

# 1) Purchases list
$listRes = Invoke-RestMethod -Uri "$BaseUrl/api/purchases" -Headers $headers
$listData = @($listRes.data)
Write-Output ("purchases_list_count=" + $listData.Count)
if ($listData.Count -gt 0) {
  Assert-NoLegacyField -Object $listData[0] -Fields $legacyFields -Scope "purchases.list[0]"
}

# 2) Purchases overview
$overviewRes = Invoke-RestMethod -Uri "$BaseUrl/api/purchases/overview" -Headers $headers
Assert-NoLegacyField -Object $overviewRes.data -Fields $legacyFields -Scope "purchases.overview"

# 3) Purchase detail (first document)
if ($listData.Count -gt 0 -and $listData[0].referenceId) {
  $ref = [string]$listData[0].referenceId
  $detailRes = Invoke-RestMethod -Uri "$BaseUrl/api/purchases/$ref" -Headers $headers
  $detail = $detailRes.data
  Assert-NoLegacyField -Object $detail -Fields $legacyFields -Scope "purchases.detail"

  if ($detail.items -and @($detail.items).Count -gt 0) {
    Assert-NoLegacyField -Object @($detail.items)[0] -Fields $legacyFields -Scope "purchases.detail.items[0]"
  }

  if ($detail.payments -and @($detail.payments).Count -gt 0) {
    Assert-NoLegacyField -Object @($detail.payments)[0] -Fields $legacyFields -Scope "purchases.detail.payments[0]"
  }
}

# 4) Cash-flow report
$cashFlowRes = Invoke-RestMethod -Uri "$BaseUrl/api/purchases/cash-flow" -Headers $headers
Assert-NoLegacyField -Object $cashFlowRes.data.totals -Fields $legacyFields -Scope "purchases.cash-flow.totals"
if ($cashFlowRes.data.rows -and @($cashFlowRes.data.rows).Count -gt 0) {
  Assert-NoLegacyField -Object @($cashFlowRes.data.rows)[0] -Fields $legacyFields -Scope "purchases.cash-flow.rows[0]"
}

# 5) Reconciliation report
$reconRes = Invoke-RestMethod -Uri "$BaseUrl/api/purchases/reconciliation" -Headers $headers
Assert-NoLegacyField -Object $reconRes.data.totals -Fields $legacyFields -Scope "purchases.reconciliation.totals"
if ($reconRes.data.rows -and @($reconRes.data.rows).Count -gt 0) {
  Assert-NoLegacyField -Object @($reconRes.data.rows)[0] -Fields $legacyFields -Scope "purchases.reconciliation.rows[0]"
}

Write-Output "PASS: No legacy discount fields found in purchase APIs"
