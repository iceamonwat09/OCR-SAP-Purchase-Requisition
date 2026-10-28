# start-sap-pr.ps1 - Start SAP PR (run as Administrator)
Import-Module WebAdministration

Start-Service PBIEgwService                                   # Power Automate gateway
Start-WebAppPool SAPPR -ErrorAction SilentlyContinue          # IIS app pool
Start-Website   SAPPR -ErrorAction SilentlyContinue           # IIS web (port 8080)

if (-not (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process "C:\Program Files\nodejs\node.exe" -ArgumentList "C:\SAP_AUTOPR\api\server.js" `
    -WorkingDirectory "C:\SAP_AUTOPR\api" -WindowStyle Hidden `
    -RedirectStandardOutput "C:\SAP_AUTOPR\logs\api.log" -RedirectStandardError "C:\SAP_AUTOPR\logs\api-error.log"
}

$ok = $false
for ($i = 0; $i -lt 15 -and -not $ok; $i++) {
  try { $ok = (Invoke-RestMethod "http://172.40.0.76:3001/api/health" -TimeoutSec 5).status -eq 'ok' } catch { Start-Sleep -Seconds 2 }
}
if ($ok) { "API: ok" } else { "API: NOT RESPONDING - see C:\SAP_AUTOPR\logs\api-error.log" }
