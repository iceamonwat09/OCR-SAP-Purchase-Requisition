<#
  SAP PR Generator - start what is stopped + quick readiness check (server 172.40.0.76)
  Run as Administrator:   .\start-sap-pr.ps1            start, then check
                          .\start-sap-pr.ps1 -CheckOnly check only (changes nothing)
  Never starts/stops VisionIQ or N8N (VisionIQ team). Never writes into the Interface folder.
#>
param([switch]$CheckOnly, [string]$Ip = "172.40.0.76", [string]$Iface = "D:\interface")

$Api = "http://${Ip}:3001/api"; $Task = "SAP_AUTOPR-API"; $Site = "SAPPR"; $Gw = "PBIEgwService"
Import-Module WebAdministration

if (-not $CheckOnly) {
  if ((Get-Service $Gw).Status -ne 'Running') { Write-Host "Starting $Gw ..."; Start-Service $Gw }
  if ((Get-WebAppPoolState $Site).Value -ne 'Started') { Write-Host "Starting app pool $Site ..."; Start-WebAppPool $Site }
  if ((Get-Website $Site).State -ne 'Started') { Write-Host "Starting IIS site $Site ..."; Start-Website $Site }
  if ((Get-ScheduledTask $Task).State -ne 'Running' -and -not (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)) {
    Write-Host "Starting Task $Task ..."; Start-ScheduledTask $Task; Start-Sleep -Seconds 8
  }
}

$fail = 0
function Check([string]$Name, [bool]$Ok, [string]$Info = "") {
  if (-not $Ok) { $script:fail++ }
  Write-Host ("{0,-4} {1,-32} {2}" -f $(if ($Ok) { "OK" } else { "FAIL" }), $Name, $Info) -ForegroundColor $(if ($Ok) { "Green" } else { "Red" })
}
function Http([string]$Url) { try { [int](Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 15).StatusCode } catch { 0 } }
function Api([string]$Path) { try { Invoke-RestMethod "$Api/$Path" -TimeoutSec 20 } catch { $null } }

Write-Host ""
Check "Task $Task"      ((Get-ScheduledTask $Task).State -eq 'Running')
Check "API health"      ((Api "health").status -eq 'ok')
Check "Database"        ((Api "test-db").success -eq $true)
Check "Web site $Site"  ((Http "http://127.0.0.1:8080/login.html") -eq 200) "http://${Ip}:8080/login.html"
Check "Gateway $Gw"     ((Get-Service $Gw).Status -eq 'Running')
$stuck = @(Get-ChildItem $Iface -Filter "SAP_PR_*.json" -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-20) }).Count
Check "Interface folder"  ((Test-Path $Iface) -and $stuck -eq 0) $(if ($stuck) { "$stuck file(s) waiting > 20 min - check Power Automate / gateway" } else { $Iface })
Check "N8N (OCR) :5678"   ((Http "http://127.0.0.1:5678/healthz") -eq 200) "read-only; if FAIL ask the VisionIQ team"

Write-Host ""
if ($fail -eq 0) { Write-Host "SYSTEM READY" -ForegroundColor Green } else { Write-Host "NOT READY ($fail check(s) failed)" -ForegroundColor Red }
