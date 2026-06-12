param(
  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion,

  [string]$ExpectedGitSha = "",
  [string]$ApiUrl = "https://api.tatien.vn",
  [string]$HeadOfficeUrl = "https://admin.tatien.vn",
  [string]$StorePosUrl = "https://pos.tatien.vn",
  [string]$CorporateWebUrl = "https://tatien.vn",
  [string]$MobileUrl = "https://mobile.tatien.vn"
)

$ErrorActionPreference = "Stop"

function Read-AppMeta {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  $html = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30
  $content = $html.Content

  $version = ""
  $gitSha = ""
  $buildTime = ""

  $versionMatch = [regex]::Match($content, '<meta\s+name="app-version"\s+content="([^"]*)"')
  if ($versionMatch.Success) {
    $version = $versionMatch.Groups[1].Value
  }

  $gitShaMatch = [regex]::Match($content, '<meta\s+name="app-git-sha"\s+content="([^"]*)"')
  if ($gitShaMatch.Success) {
    $gitSha = $gitShaMatch.Groups[1].Value
  }

  $buildTimeMatch = [regex]::Match($content, '<meta\s+name="app-build-time"\s+content="([^"]*)"')
  if ($buildTimeMatch.Success) {
    $buildTime = $buildTimeMatch.Groups[1].Value
  }

  return [PSCustomObject]@{
    version = $version
    gitSha = $gitSha
    buildTime = $buildTime
  }
}

function Assert-Match {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Actual,
    [Parameter(Mandatory = $true)]
    [string]$Expected
  )

  if ($Actual -ne $Expected) {
    if ($Actual -match '^%VITE_[A-Z0-9_]+%$') {
      throw "$Name is unresolved placeholder '$Actual'. Frontend likely running dev source or built without VITE_APP_VERSION/VITE_APP_GIT_SHA/VITE_APP_BUILD_TIME."
    }
    throw "$Name mismatch. Expected '$Expected' but got '$Actual'."
  }
}

Write-Host "=== Verify deployed version ===" -ForegroundColor Cyan
Write-Host "Expected version: $ExpectedVersion"
if ($ExpectedGitSha) {
  Write-Host "Expected git sha: $ExpectedGitSha"
}

$apiVersion = Invoke-RestMethod -Uri "$ApiUrl/version" -TimeoutSec 30

Assert-Match -Name "API version" -Actual ([string]$apiVersion.version) -Expected $ExpectedVersion
if ($ExpectedGitSha) {
  Assert-Match -Name "API git sha" -Actual ([string]$apiVersion.gitSha) -Expected $ExpectedGitSha
}

$targets = @(
  @{ Name = "head-office"; Url = $HeadOfficeUrl },
  @{ Name = "store-pos"; Url = $StorePosUrl },
  @{ Name = "corporate-web"; Url = $CorporateWebUrl },
  @{ Name = "mobile"; Url = $MobileUrl }
)

foreach ($target in $targets) {
  $meta = Read-AppMeta -Url $target.Url
  Assert-Match -Name "$($target.Name) version" -Actual ([string]$meta.version) -Expected $ExpectedVersion
  if ($ExpectedGitSha) {
    Assert-Match -Name "$($target.Name) git sha" -Actual ([string]$meta.gitSha) -Expected $ExpectedGitSha
  }
}

Write-Host "Deploy version verification passed." -ForegroundColor Green