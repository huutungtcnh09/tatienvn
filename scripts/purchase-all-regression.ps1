$ErrorActionPreference = "Stop"
$tradeScript = Join-Path $PSScriptRoot "purchase-trade-rebate-regression.ps1"
$rebateBatchScript = Join-Path $PSScriptRoot "purchase-rebate-batch-regression.ps1"

Write-Host "=== RUN PURCHASE REGRESSION: TRADE REBATE ===" -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File $tradeScript
if ($LASTEXITCODE -ne 0) { throw "Trade rebate regression failed" }

Write-Host "=== RUN PURCHASE REGRESSION: REBATE BATCH ===" -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File $rebateBatchScript
if ($LASTEXITCODE -ne 0) { throw "Rebate batch regression failed" }

Write-Host "=== ALL PURCHASE REGRESSION PASSED ===" -ForegroundColor Green
