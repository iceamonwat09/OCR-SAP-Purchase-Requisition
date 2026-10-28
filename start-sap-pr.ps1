<#
  SAP PR Generator - start everything + readiness check (server 172.40.0.76)

  START : starts only what belongs to SAP PR and is stopped:
            - Power Automate on-premises data gateway service (PBIEgwService)
            - IIS app pool + site SAPPR
            - Scheduled Task SAP_AUTOPR-API (Node API, port 3001)
  CHECK : API, database, web, gateway, Interface folder, firewall, VisionIQ/N8N, disk, log.

  Safety:
    - NEVER starts, stops or kills VisionIQ or N8N (owned by the VisionIQ team). It only checks them.
    - NEVER writes any file into the Interface folder (Power Automate would upload it to SharePoint).
    - Only SAP PR items are touched. Nothing is stopped.

  Usage (PowerShell as Administrator):
    .\start-sap-pr.ps1               start what is stopped, then check
    .\start-sap-pr.ps1 -CheckOnly    check only, change nothing
#>
param(
  [switch]$CheckOnly,
  [string]$Root = "C:\SAP_AUTOPR",
  [string]$Iface = "D:\interface",
  [string]$ServerIp = "172.40.0.76",
  [int]$ApiPort = 3001,
  [int]$WebPort = 8080,
  [int]$StuckMinutes = 20
)

$ApiDir      = Join-Path $Root "api"
$LogDir      = Join-Path $Root "logs"
$ServerJs    = Join-Path $ApiDir "server.js"
$TaskName    = "SAP_AUTOPR-API"
$SiteName    = "SAPPR"
$GatewayName = "PBIEgwService"
$ApiBase     = "http://${ServerIp}:$ApiPort/api"

$script:Results = New-Object System.Collections.ArrayList
function Add-Result([string]$Area, [string]$Check, [string]$Status, [string]$Detail) {
  [void]$script:Results.Add([pscustomobject]@{ Area = $Area; Check = $Check; Status = $Status; Detail = $Detail })
}

function Get-HttpCode([string]$Url) {
  try { return [int](Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 15).StatusCode }
  catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

# node.exe that runs OUR server.js only (never matches N8N)
function Get-SapApiProcess {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$ServerJs*" }
}

function Test-ApiHealth {
  try { return ((Invoke-RestMethod "$ApiBase/health" -TimeoutSec 5).status -eq 'ok') } catch { return $false }
}

Write-Host ""
Write-Host "=== SAP PR Generator  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" -ForegroundColor Cyan

# ------------------------------------------------------------------ START
if ($CheckOnly) {
  Write-Host "[CheckOnly] nothing will be started" -ForegroundColor Yellow
} else {
  Write-Host "--- Start (only what is stopped) ---" -ForegroundColor Cyan

  # 1) Power Automate gateway service
  $gw = Get-Service -Name $GatewayName -ErrorAction SilentlyContinue
  if (-not $gw) { Write-Host "  Gateway service $GatewayName not found" -ForegroundColor Red }
  elseif ($gw.Status -ne 'Running') {
    Write-Host "  Starting $GatewayName ..."
    try { Start-Service -Name $GatewayName -ErrorAction Stop; $gw.WaitForStatus('Running', '00:00:30') }
    catch { Write-Host "  Could not start ${GatewayName}: $($_.Exception.Message)" -ForegroundColor Red }
  } else { Write-Host "  $GatewayName already running" }

  # 2) IIS app pool + site SAPPR
  try {
    Import-Module WebAdministration -ErrorAction Stop
    if (Get-Website -Name $SiteName -ErrorAction SilentlyContinue) {
      if ((Get-WebAppPoolState -Name $SiteName).Value -ne 'Started') { Write-Host "  Starting app pool $SiteName ..."; Start-WebAppPool -Name $SiteName }
      if ((Get-Website -Name $SiteName).State -ne 'Started') { Write-Host "  Starting IIS site $SiteName ..."; Start-Website -Name $SiteName }
      else { Write-Host "  IIS site $SiteName already started" }
    } else { Write-Host "  IIS site $SiteName not found" -ForegroundColor Red }
  } catch { Write-Host "  IIS: $($_.Exception.Message)" -ForegroundColor Red }

  # 3) API (Scheduled Task)
  $task     = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $ours     = @(Get-SapApiProcess)
  $listener = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $task) { Write-Host "  Scheduled Task $TaskName not found" -ForegroundColor Red }
  elseif ($ours.Count -gt 0) { Write-Host "  API already running (PID $($ours[0].ProcessId))" }
  elseif ($listener) { Write-Host "  Port $ApiPort is used by another process (PID $($listener.OwningProcess)) - API NOT started" -ForegroundColor Red }
  else {
    Write-Host "  Starting Task $TaskName ..."
    Start-ScheduledTask -TaskName $TaskName
    for ($i = 0; $i -lt 15; $i++) { Start-Sleep -Seconds 2; if (Test-ApiHealth) { break } }
  }
}

# ------------------------------------------------------------------ CHECK
Write-Host "--- Check ---" -ForegroundColor Cyan

# API process / task
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { Add-Result "API" "Scheduled Task $TaskName" "FAIL" "not found (see DEPLOY.md step 6)" }
elseif ($task.State -eq 'Running') { Add-Result "API" "Scheduled Task $TaskName" "OK" "Running" }
else { Add-Result "API" "Scheduled Task $TaskName" "FAIL" "State = $($task.State)" }

$procs = @(Get-SapApiProcess)
if ($procs.Count -eq 1) { Add-Result "API" "node server.js process" "OK" "PID $($procs[0].ProcessId)" }
elseif ($procs.Count -gt 1) { Add-Result "API" "node server.js process" "WARN" "$($procs.Count) copies running (PIDs $($procs.ProcessId -join ', '))" }
else { Add-Result "API" "node server.js process" "FAIL" "not running" }

# API endpoints (read-only)
try { $r = Invoke-RestMethod "$ApiBase/health" -TimeoutSec 15; if ($r.status -eq 'ok') { Add-Result "API" "GET /api/health" "OK" "status ok" } else { Add-Result "API" "GET /api/health" "FAIL" "unexpected reply" } }
catch { Add-Result "API" "GET /api/health" "FAIL" $_.Exception.Message }

try { $r = Invoke-RestMethod "$ApiBase/test-db" -TimeoutSec 20; if ($r.success) { Add-Result "Database" "SQL Server (SAP_AUTOPR)" "OK" "connected" } else { Add-Result "Database" "SQL Server (SAP_AUTOPR)" "FAIL" "$($r.message)" } }
catch { Add-Result "Database" "SQL Server (SAP_AUTOPR)" "FAIL" $_.Exception.Message }

try {
  $r = Invoke-RestMethod "$ApiBase/processflow/list" -TimeoutSec 20
  $rows = @($r.data)
  $bad  = @($rows | Where-Object { $_.WebHook -notlike "http://${ServerIp}:5678/*" })
  if ($rows.Count -eq 0) { Add-Result "Database" "ProcessFlow webhooks" "FAIL" "table is empty" }
  elseif ($bad.Count -gt 0) { Add-Result "Database" "ProcessFlow webhooks" "WARN" "$($bad.Count) of $($rows.Count) row(s) do not point to ${ServerIp}:5678 (ID $($bad.ID -join ', '))" }
  else { Add-Result "Database" "ProcessFlow webhooks" "OK" "$($rows.Count) row(s) point to ${ServerIp}:5678" }
} catch { Add-Result "Database" "ProcessFlow webhooks" "FAIL" $_.Exception.Message }

# Web (IIS)
try {
  Import-Module WebAdministration -ErrorAction Stop
  $site = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
  if (-not $site) { Add-Result "Web" "IIS site $SiteName" "FAIL" "not found" }
  elseif ($site.State -eq 'Started') { Add-Result "Web" "IIS site $SiteName" "OK" "Started on port $WebPort" }
  else { Add-Result "Web" "IIS site $SiteName" "FAIL" "State = $($site.State)" }
} catch { Add-Result "Web" "IIS site $SiteName" "FAIL" $_.Exception.Message }

$code = Get-HttpCode "http://127.0.0.1:$WebPort/login.html"
if ($code -eq 200) { Add-Result "Web" "GET /login.html" "OK" "HTTP 200" } else { Add-Result "Web" "GET /login.html" "FAIL" "HTTP $code" }
$code = Get-HttpCode "http://127.0.0.1:$WebPort/server.js"
if ($code -eq 404) { Add-Result "Web" "GET /server.js must be hidden" "OK" "HTTP 404" } else { Add-Result "Web" "GET /server.js must be hidden" "FAIL" "HTTP $code (server.js may be exposed!)" }

# Interface pipeline: D:\interface -> Power Automate (gateway) -> SharePoint
$gw = Get-Service -Name $GatewayName -ErrorAction SilentlyContinue
if (-not $gw) { Add-Result "Interface" "Gateway service $GatewayName" "FAIL" "not found" }
elseif ($gw.Status -eq 'Running') { Add-Result "Interface" "Gateway service $GatewayName" "OK" "Running" }
else { Add-Result "Interface" "Gateway service $GatewayName" "FAIL" "Status = $($gw.Status)" }

if (Test-Path $Iface) {
  Add-Result "Interface" "Folder $Iface" "OK" "exists"
  $pending = @(Get-ChildItem $Iface -Filter "SAP_PR_*.json" -File -ErrorAction SilentlyContinue)
  $stuck   = @($pending | Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-$StuckMinutes) })
  if ($stuck.Count -gt 0) { Add-Result "Interface" "Files waiting for Power Automate" "WARN" "$($stuck.Count) file(s) older than $StuckMinutes min (oldest: $($stuck | Sort-Object LastWriteTime | Select-Object -First 1 -ExpandProperty Name)) - check the flow and the gateway" }
  else { Add-Result "Interface" "Files waiting for Power Automate" "OK" "$($pending.Count) waiting, none older than $StuckMinutes min" }
} else { Add-Result "Interface" "Folder $Iface" "FAIL" "not found" }
if (Test-Path (Join-Path $Iface "Backup")) { Add-Result "Interface" "Folder Backup" "OK" "exists" } else { Add-Result "Interface" "Folder Backup" "WARN" "not found (Power Automate creates/uses it)" }

try { $r = Invoke-RestMethod "$ApiBase/check-share" -TimeoutSec 15; if ($r.success) { Add-Result "Interface" "API can read Interface folder" "OK" "check-share success" } else { Add-Result "Interface" "API can read Interface folder" "FAIL" "$($r.message)" } }
catch { Add-Result "Interface" "API can read Interface folder" "FAIL" $_.Exception.Message }

# Firewall (our rules only)
foreach ($name in "SAP PR API $ApiPort", "SAP PR WEB $WebPort") {
  $fw = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
  if (-not $fw) { Add-Result "Firewall" $name "FAIL" "rule not found" }
  elseif ("$($fw.Enabled)" -eq 'True') { Add-Result "Firewall" $name "OK" "enabled" }
  else { Add-Result "Firewall" $name "FAIL" "rule is disabled" }
}

# Neighbours (read-only, NEVER started by this script)
$code = Get-HttpCode "http://127.0.0.1:5678/healthz"
if ($code -eq 200) { Add-Result "Neighbour" "N8N (OCR) :5678" "OK" "HTTP 200" }
else { Add-Result "Neighbour" "N8N (OCR) :5678" "FAIL" "HTTP $code - OCR scanning will not work; ask the VisionIQ team to start N8N (not started by this script)" }
$code = Get-HttpCode "http://127.0.0.1:8000/artwork_check"
if ($code -eq 200) { Add-Result "Neighbour" "VisionIQ :8000" "INFO" "HTTP 200 (not managed by this script)" }
else { Add-Result "Neighbour" "VisionIQ :8000" "WARN" "HTTP $code (not managed by this script - tell the VisionIQ team)" }

# Resources
foreach ($d in "C", "D") {
  $drv = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -eq $d } | Select-Object -First 1
  if ($drv) {
    $free = [math]::Round($drv.Free / 1GB, 1)
    if ($free -lt 2) { Add-Result "Resources" "Free space ${d}:" "WARN" "$free GB left" } else { Add-Result "Resources" "Free space ${d}:" "OK" "$free GB free" }
  }
}
$apiLog = Join-Path $LogDir "api.log"
if (Test-Path $apiLog) {
  $mb = [math]::Round((Get-Item $apiLog).Length / 1MB, 1)
  if ($mb -gt 200) { Add-Result "Resources" "api.log size" "WARN" "$mb MB (rotate it: see DEPLOY.md)" } else { Add-Result "Resources" "api.log size" "OK" "$mb MB" }
}

# ------------------------------------------------------------------ REPORT
Write-Host ""
foreach ($x in $script:Results) {
  $color = switch ($x.Status) { 'OK' { 'Green' } 'INFO' { 'Gray' } 'WARN' { 'Yellow' } default { 'Red' } }
  Write-Host ("{0,-5} {1,-10} {2,-38} {3}" -f $x.Status, $x.Area, $x.Check, $x.Detail) -ForegroundColor $color
}
$nOk   = @($script:Results | Where-Object { $_.Status -in 'OK', 'INFO' }).Count
$nWarn = @($script:Results | Where-Object { $_.Status -eq 'WARN' }).Count
$nFail = @($script:Results | Where-Object { $_.Status -eq 'FAIL' }).Count
Write-Host ""
if ($nFail -eq 0 -and $nWarn -eq 0) { Write-Host "RESULT: SYSTEM READY  (OK=$nOk)" -ForegroundColor Green }
elseif ($nFail -eq 0) { Write-Host "RESULT: READY WITH WARNINGS  (OK=$nOk, WARN=$nWarn)" -ForegroundColor Yellow }
else { Write-Host "RESULT: NOT READY  (OK=$nOk, WARN=$nWarn, FAIL=$nFail)" -ForegroundColor Red }
Write-Host "Users open: http://${ServerIp}:$WebPort/login.html"

# save a copy of the report
try {
  New-Item -ItemType Directory $LogDir -Force | Out-Null
  $report = Join-Path $LogDir ("health-" + (Get-Date -Format 'yyyyMMdd_HHmmss') + ".txt")
  ($script:Results | Format-Table -AutoSize | Out-String -Width 250) | Set-Content -Path $report -Encoding UTF8
  Write-Host "Report saved: $report"
} catch { }
