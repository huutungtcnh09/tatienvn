$ErrorActionPreference = "Stop"

$tradeScript = Join-Path $PSScriptRoot "purchase-trade-rebate-regression.ps1"
$rebateBatchScript = Join-Path $PSScriptRoot "purchase-rebate-batch-regression.ps1"

$ProgressPreference = "SilentlyContinue"

Write-Host "[CI] purchase trade rebate regression"
& powershell -NoProfile -ExecutionPolicy Bypass -File $tradeScript
if ($LASTEXITCODE -ne 0) {
  Write-Error "Trade rebate regression failed"
  exit $LASTEXITCODE
}

Write-Host "[CI] purchase rebate-batch regression"
& powershell -NoProfile -ExecutionPolicy Bypass -File $rebateBatchScript
if ($LASTEXITCODE -ne 0) {
  Write-Error "Rebate-batch regression failed"
  exit $LASTEXITCODE
}

Write-Host "[CI] purchase regressions passed"
