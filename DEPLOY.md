# คู่มือ Deploy SAP PR Generator บน Server 172.40.0.76 (แบบปลอดภัย)

คู่มือนี้ติดตั้ง SAP PR Generator บนเครื่องที่มี **VisionIQ** (python พอร์ต 8000) และ **N8N** (node พอร์ต 5678/5679) รันอยู่ ทุกขั้นตอนทำตามข้อตกลงใน [README.md](README.md) หัวข้อ 11

## สรุปสิ่งที่จะติดตั้ง

| ส่วน | ตำแหน่ง | พอร์ต | ชื่อที่ใช้ |
|---|---|---|---|
| API (Node `server.js`) | `C:\SAP_AUTOPR\api` | 3001 | Scheduled Task `SAP_AUTOPR-API`, Firewall `SAP PR API 3001` |
| หน้าเว็บ (IIS) | `C:\SAP_AUTOPR\web` | 8080 | IIS Site + App Pool `SAPPR`, Firewall `SAP PR WEB 8080` |
| Log ของ API | `C:\SAP_AUTOPR\logs\api.log` | – | – |
| สำเนา JSON ที่ส่ง | `C:\SAP_AUTOPR\api\sent-json\YYYY-MM\` | – | สร้างเองอัตโนมัติ |

ผู้ใช้เปิดระบบที่ **`http://172.40.0.76:8080/login.html`**

## กฎที่ต้องทำตามตลอดการ Deploy

- ❌ ห้าม `taskkill /IM node.exe` หรือ `taskkill /IM python.exe` ให้ใช้ฟังก์ชัน `Stop-SapApi` ในคู่มือนี้เท่านั้น
- ❌ ห้ามแตะ `C:\VisionIQ\`, Task `VisionIQ-Waitress`, Firewall `VisionIQ HTTP 8000`, เว็บ IIS `Default Web Site` และ `VisionIQ`
- ❌ ห้ามใช้พอร์ต 8000, 5678, 5679 สำหรับเปิดบริการ
- ❌ ห้าม `npm install -g`, ติดตั้ง Node ใหม่, nvm หรือแก้ PATH
- ❌ ห้าม restart เครื่อง (ถ้าจำเป็นต้องแจ้งทีม VisionIQ ก่อน)
- ✅ หลังทุกขั้นตอน รัน `Show-Neighbors` แล้ว**เทียบกับผล baseline (ขั้นที่ 1)** เพื่อยืนยันว่า VisionIQ และ N8N ยังปกติ ถ้าผิดไปจาก baseline **หยุดทันที** แล้วดูหัวข้อ "ย้อนกลับ"

## สถานะที่ทำไปแล้ว

| รายการ | สถานะ |
|---|---|
| รัน `migration.sql` บน `SAP_AUTOPR` | ✅ |
| Firewall `SAP PR API 3001` | ✅ |
| โฟลเดอร์ `C:\SAP_AUTOPR\api` (มี `package.json`, `node_modules` ที่เป็น Express 5) | ✅ จะติดตั้งใหม่เป็น Express 4 ในขั้นที่ 3 |
| Workflow N8N 2 ตัว Publish แล้ว | ✅ |

## ข้อมูลที่ต้องมีก่อนเริ่ม

1. **ไฟล์โปรเจคเวอร์ชันล่าสุด** จาก GitHub branch `claude/setup-developer-workflow-R97LD` (ดาวน์โหลด ZIP แล้วแตกไฟล์ไว้ในเครื่อง)
2. **บัญชี Windows สำหรับรัน API** ที่มีสิทธิ์เขียนโฟลเดอร์ Interface (เช่น `thaiunion\tuf.operation`) และรหัสผ่านของบัญชีนั้น
3. **OneDrive บน server** sign in ด้วยบัญชี `tuf.operation` และมี Shortcut `Digital Team - APAC Cluster #1 - Interface_Outbound` แล้ว (ดูขั้นที่ 9)

> ใช้ **Windows PowerShell แบบ Run as Administrator** ทุกขั้น
> โค้ดใน PowerShell เขียนเป็นภาษาอังกฤษเพื่อไม่ให้ตัวอักษรเพี้ยน
> ถ้าเปิดหน้าต่าง PowerShell ใหม่ ต้องรัน **ขั้นที่ 0** ใหม่ทุกครั้ง

---

## ขั้นที่ 0 — ตั้งค่าตัวแปรและฟังก์ชันช่วย

แก้แค่บรรทัด `$Src` ให้เป็นโฟลเดอร์ที่แตกไฟล์จาก GitHub ไว้ (โฟลเดอร์ที่มี `server.js` และ `index.html`)

```powershell
$Src     = "C:\Users\tuf.operation\Downloads\OCR-SAP-Purchase-Requisition-claude-setup-developer-workflow-R97LD"  # EDIT THIS LINE
$Root    = "C:\SAP_AUTOPR"
$ApiDir  = "$Root\api"
$WebDir  = "$Root\web"
$LogDir  = "$Root\logs"
$ApiPort = 3001
$WebPort = 8080
$TaskName = "SAP_AUTOPR-API"
$SiteName = "SAPPR"
$NodeExe = (Get-Command node -ErrorAction Stop).Source
Import-Module WebAdministration

# Find the node.exe that runs OUR server.js only (never touches N8N)
function Get-SapApiProcess {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$ApiDir\server.js*" }
}

# Stop OUR API only (by PID), never taskkill /IM
function Stop-SapApi {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-SapApiProcess | ForEach-Object {
    Write-Host "Stopping SAP API node PID $($_.ProcessId): $($_.CommandLine)"
    taskkill /PID $_.ProcessId /F | Out-Null
  }
}

# Health of neighbours (VisionIQ, N8N) + our ports
function Show-Neighbors {
  Write-Host "`n--- Neighbour check $(Get-Date -Format 'HH:mm:ss') ---" -ForegroundColor Cyan
  foreach ($p in 8000, 5678, $ApiPort, $WebPort) {
    $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { "Port {0,-5}: {1} (PID {2})" -f $p, (Get-Process -Id $c.OwningProcess).ProcessName, $c.OwningProcess }
    else    { "Port {0,-5}: free" -f $p }
  }
  try { $r = Invoke-WebRequest "http://127.0.0.1:8000/artwork_check" -UseBasicParsing -TimeoutSec 15; "VisionIQ /artwork_check : HTTP $($r.StatusCode)" }
  catch { "VisionIQ /artwork_check : FAIL $($_.Exception.Message)" }
  try { $r = Invoke-WebRequest "http://127.0.0.1:5678/healthz" -UseBasicParsing -TimeoutSec 15; "N8N /healthz           : HTTP $($r.StatusCode)" }
  catch { "N8N /healthz           : FAIL $($_.Exception.Message)" }
  Get-ScheduledTask -TaskName "VisionIQ-Waitress" -ErrorAction SilentlyContinue | ForEach-Object { "Task VisionIQ-Waitress : $($_.State)" }
  Get-Website | ForEach-Object { "IIS site {0,-17}: {1}" -f $_.Name, $_.State }
}

# Verify the source folder is the right version
$need = "server.js","index.html","master.html","history.html","login.html","auth-config.js"
$missing = $need | Where-Object { -not (Test-Path "$Src\$_") }
if ($missing) { throw "Source folder is missing: $($missing -join ', ')" }
if (-not (Select-String -Path "$Src\index.html" -Pattern "172.40.0.76:3001" -Quiet)) { throw "index.html is an old version (API URL is not 172.40.0.76)" }
if (-not (Select-String -Path "$Src\server.js" -Pattern "ARCHIVE_PATH" -Quiet)) { throw "server.js is an old version" }
"Source OK: $Src"
"Node: $NodeExe  $(node -v)"
```

**ผลที่ต้องได้:** `Source OK: ...` และเวอร์ชัน Node ถ้าขึ้น error แปลว่า path ผิดหรือไฟล์ไม่ใช่เวอร์ชันล่าสุด ให้แก้ก่อนไปต่อ

---

## ขั้นที่ 1 — บันทึกสถานะก่อนเริ่ม (Baseline)

```powershell
New-Item -ItemType Directory $LogDir -Force | Out-Null
Show-Neighbors | Tee-Object -FilePath "$LogDir\baseline-$(Get-Date -Format yyyyMMdd_HHmmss).txt"
```

**ผลที่ต้องได้:**
- Port 8000 = python, Port 5678 = node (N8N)
- VisionIQ และ N8N = HTTP 200
- Port 3001 และ 8080 = **free** ถ้าไม่ว่าง **หยุด** แล้วแจ้งผู้ดูแลระบบ อย่าปิดโปรแกรมที่ใช้พอร์ตนั้น

---

## ขั้นที่ 2 — ตรวจพอร์ตด้วย netstat (ตามข้อตกลงข้อ 3)

```powershell
netstat -ano -p TCP | findstr ":3001 :8080"
```
**ผลที่ต้องได้:** ไม่มีบรรทัดที่เป็น `LISTENING` ถ้ามี ให้หยุดและแจ้งผู้ดูแลระบบ

---

## ขั้นที่ 3 — ติดตั้ง API

```powershell
New-Item -ItemType Directory $ApiDir -Force | Out-Null
Set-Location $ApiDir
if ((Get-Location).Path -ne $ApiDir) { throw "Not in $ApiDir - stop" }

# Back up the current server.js (if any)
if (Test-Path "$ApiDir\server.js") { Copy-Item "$ApiDir\server.js" "$ApiDir\server.js.bak-$(Get-Date -Format yyyyMMdd_HHmmss)" }
Copy-Item "$Src\server.js" $ApiDir -Force

if (-not (Test-Path "$ApiDir\package.json")) { npm init -y | Out-Null }
npm install express@4 mssql cors          # local only, never -g
npm ls express mssql cors --depth=0
node --check "$ApiDir\server.js"; if ($LASTEXITCODE -eq 0) { "server.js syntax OK" }
Show-Neighbors
```

**ผลที่ต้องได้:**
- `npm ls` แสดง `express@4.x.x`, `mssql@...`, `cors@...`
- `server.js syntax OK`
- `Show-Neighbors`: VisionIQ และ N8N ยัง HTTP 200

---

## ขั้นที่ 4 — ทดสอบรัน API ด้วยมือ (ยังไม่ตั้ง Task)

**4.1** เปิด PowerShell **หน้าต่างใหม่** แล้วรัน:
```powershell
& (Get-Command node).Source C:\SAP_AUTOPR\api\server.js
```
ต้องเห็นกรอบรายการ endpoint, `Server running on port 3001` และ `Archive Path: C:\SAP_AUTOPR\api\sent-json`
**เปิดหน้าต่างนี้ค้างไว้**

**4.2** กลับมาที่หน้าต่างหลัก ทดสอบ:
```powershell
$Api = "http://172.40.0.76:$ApiPort/api"
foreach ($e in "health","test-db","processflow/list","department/list","check-share") {
  try { $r = Invoke-RestMethod "$Api/$e" -TimeoutSec 20; "{0,-18} OK" -f $e; if ($e -eq "processflow/list") { $r.data | Format-Table ID, Description, WebHook -AutoSize } }
  catch { "{0,-18} FAIL {1}" -f $e, $_.ErrorDetails.Message }
}
Show-Neighbors
```

**ผลที่ต้องได้:**

| endpoint | ผล |
|---|---|
| `health` | OK |
| `test-db` | OK (ถ้า FAIL = ต่อ SQL ไม่ได้ ห้ามไปต่อ) |
| `processflow/list` | OK และตาราง WebHook ต้องเป็น `http://172.40.0.76:5678/webhook/...` ทั้ง 2 path |
| `department/list` | OK |
| `check-share` | OK (ถ้า FAIL = ไม่พบโฟลเดอร์ OneDrive Shortcut ดูขั้นที่ 9) |

ถ้า WebHook ใน ProcessFlow ยังไม่ใช่ `172.40.0.76` ให้แก้ด้วย SSMS ก่อน (ดู `update-processflow.sql`)

**4.3** หยุด API ที่รันด้วยมือ: ไปที่หน้าต่างจากข้อ 4.1 แล้วกด **Ctrl+C** (ห้ามใช้ taskkill /IM)
```powershell
Get-SapApiProcess   # must return nothing
```

---

## ขั้นที่ 5 — ตั้ง Scheduled Task `SAP_AUTOPR-API` (รันตลอด และเปิดเองเมื่อเครื่องเปิด)

**5.1** สร้างไฟล์สำหรับเปิด API ที่เขียน log ลงไฟล์:
```powershell
@"
@echo off
cd /d $ApiDir
"$NodeExe" $ApiDir\server.js >> $LogDir\api.log 2>&1
"@ | Set-Content -Path "$ApiDir\start-api.cmd" -Encoding ASCII
Get-Content "$ApiDir\start-api.cmd"
```

**5.2** สร้าง Task (ระบบจะถามรหัสผ่านของบัญชีที่ใช้รัน):
```powershell
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw "Task $TaskName already exists - check before overwriting" }
$cred     = Get-Credential -UserName "thaiunion\tuf.operation" -Message "Account that runs SAP_AUTOPR-API (needs write access to the Interface folder)"
icacls $Root /grant "$($cred.UserName):(OI)(CI)M" | Out-Null   # write logs + sent-json
$action   = New-ScheduledTaskAction -Execute "$ApiDir\start-api.cmd" -WorkingDirectory $ApiDir
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Limited `
  -Description "SAP PR Generator API (node server.js on port $ApiPort)" | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 8
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
Get-SapApiProcess | Select-Object ProcessId, CommandLine | Format-List
Get-Content "$LogDir\api.log" -Tail 25 -Encoding UTF8
Show-Neighbors
```

**ผลที่ต้องได้:**
- Task State = `Running`
- `Get-SapApiProcess` แสดง node 1 ตัวที่มี `C:\SAP_AUTOPR\api\server.js`
- `api.log` มีกรอบรายการ endpoint
- Port 3001 = node และ VisionIQ / N8N ยัง HTTP 200

> `-ExecutionTimeLimit 0` สำคัญมาก ค่าเริ่มต้นของ Task Scheduler จะหยุด Task หลัง 3 วัน
> ถ้าเปลี่ยนรหัสผ่านบัญชีนี้ในอนาคต ต้องแก้รหัสใน Task ด้วย ไม่งั้น API จะไม่เปิดหลัง reboot

---

## ขั้นที่ 6 — Firewall ของหน้าเว็บ

```powershell
if (-not (Get-NetFirewallRule -DisplayName "SAP PR WEB $WebPort" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "SAP PR WEB $WebPort" -Direction Inbound -Protocol TCP -LocalPort $WebPort -Action Allow | Out-Null
}
Get-NetFirewallRule -DisplayName "SAP PR*" | Select-Object DisplayName, Enabled, Direction, Action
```
**ผลที่ต้องได้:** มี `SAP PR API 3001` และ `SAP PR WEB 8080` เป็น Enabled = True (ไม่แก้ rule อื่น)

---

## ขั้นที่ 7 — ติดตั้งหน้าเว็บใน IIS (Site ใหม่ `SAPPR` พอร์ต 8080)

```powershell
if (Get-Website -Name $SiteName -ErrorAction SilentlyContinue) { throw "IIS site $SiteName already exists - check before continuing" }
if (Get-NetTCPConnection -LocalPort $WebPort -State Listen -ErrorAction SilentlyContinue) { throw "Port $WebPort is in use - stop" }

New-Item -ItemType Directory $WebDir -Force | Out-Null
"login.html","index.html","master.html","history.html","auth-config.js" | ForEach-Object { Copy-Item "$Src\$_" $WebDir -Force }
if (Test-Path "$WebDir\server.js") { throw "server.js must NOT be in the web folder" }

# Read-only access for IIS
icacls $WebDir /grant "IIS_IUSRS:(OI)(CI)RX" "IUSR:(OI)(CI)RX" | Out-Null

# Dedicated app pool (static files only, no .NET)
if (-not (Test-Path "IIS:\AppPools\$SiteName")) {
  New-WebAppPool -Name $SiteName | Out-Null
  Set-ItemProperty "IIS:\AppPools\$SiteName" -Name managedRuntimeVersion -Value ""
}
New-Website -Name $SiteName -Port $WebPort -IPAddress "*" -PhysicalPath $WebDir -ApplicationPool $SiteName | Out-Null
Add-WebConfigurationProperty -PSPath "IIS:\Sites\$SiteName" -Filter "system.webServer/defaultDocument/files" -Name "." -Value @{value='login.html'} -AtIndex 0
Start-Website -Name $SiteName

foreach ($u in "", "login.html", "index.html", "master.html", "history.html", "auth-config.js", "server.js") {
  try { $r = Invoke-WebRequest "http://localhost:$WebPort/$u" -UseBasicParsing -TimeoutSec 15; "{0,-16} {1}" -f "/$u", $r.StatusCode }
  catch { "{0,-16} {1}" -f "/$u", $_.Exception.Response.StatusCode.value__ }
}
Show-Neighbors
```

**ผลที่ต้องได้:**
- `/`, `/login.html` ถึง `/auth-config.js` = **200**
- `/server.js` = **404**
- IIS: `SAPPR` = Started, ส่วน `Default Web Site` และ `VisionIQ` **สถานะเหมือน baseline**
- VisionIQ และ N8N ยัง HTTP 200

---

## ขั้นที่ 8 — ทดสอบจากเครื่องผู้ใช้ (ไม่ใช่ server)

**8.1** ทดสอบการเชื่อมต่อ (PowerShell บนเครื่องผู้ใช้):
```powershell
foreach ($p in 8080, 3001, 5678) { "Port {0}: {1}" -f $p, (Test-NetConnection 172.40.0.76 -Port $p -InformationLevel Quiet) }
```
ทั้ง 3 พอร์ตต้องเป็น `True` ถ้า 5678 เป็น `False` ให้แจ้งทีม VisionIQ เพื่อเปิด Firewall ของ N8N (เป็นบริการของทีม VisionIQ)

**8.2** ทดสอบการใช้งานในเบราว์เซอร์ที่ `http://172.40.0.76:8080/login.html` (กด Ctrl+F5 ครั้งแรก)

| # | ทดสอบ | ผลที่ต้องได้ |
|---|---|---|
| 1 | กด Guest login | เข้าหน้า OCR Generator |
| 2 | dropdown Process Flow | มี 2 รายการ เลือกแล้วช่อง Webhook URL เปลี่ยนเป็น `http://172.40.0.76:5678/webhook/...` |
| 3 | อัปโหลด PDF 1 ไฟล์ → เริ่มสแกน OCR | ไฟล์ขึ้น ✓ และแสดงรายการ Items (ถ้า F12 → Console มี CORS error ให้แจ้งทีม VisionIQ ตั้ง Allowed Origins ของ Webhook node) |
| 4 | ปุ่ม "ทดสอบ API" | ✅ API พร้อมใช้งาน |
| 5 | "ค้นหาและเติมข้อมูล" | Items ที่มี S/N ใน Master ถูกเติมข้อมูล |
| 6 | Preview | JSON ถูกต้อง |
| 7 | ไม่กรอก Email แล้วกด Send to Interface | มี popup เตือน |
| 8 | กรอก Email แล้ว Send to Interface | สำเร็จ และไฟล์ขึ้น SharePoint `SAP/Interface_Outbound` |
| 9 | เมนู Master Data | แสดงข้อมูล ตัวกรอง Plant ใช้ได้ คอลัมน์ Department แสดง |
| 10 | เมนู Send History | แสดงรายการ ตัวกรองชื่อไฟล์ใช้ได้ ปุ่ม "แก้ไข / ส่งใหม่" เปิดข้อมูลเดิมได้ |

**8.3** หลังทดสอบเสร็จ กลับไปรันบน server:
```powershell
Show-Neighbors
Get-Content "$LogDir\api.log" -Tail 30 -Encoding UTF8
```

---

## ขั้นที่ 9 — ตรวจโฟลเดอร์ Interface (OneDrive → SharePoint)

`server.js` เขียนไฟล์ JSON ไปที่
`C:\Users\tuf.operation\OneDrive - Thai Union Group\Shortcuts\Digital Team - APAC Cluster #1 - Interface_Outbound`
ซึ่งเป็น OneDrive Shortcut ของบัญชี `tuf.operation` แล้ว OneDrive จะ sync ขึ้น SharePoint `SAP/Interface_Outbound`

> **สำคัญ:** OneDrive sync เฉพาะตอนบัญชี `tuf.operation` login อยู่บน server
> เมื่อเลิกใช้ Remote Desktop ให้ **ปิดหน้าต่าง (Disconnect)** ห้าม **Sign out** ถ้า sign out ไฟล์จะค้างอยู่ในเครื่อง และขึ้น SharePoint เมื่อ login กลับ (ไฟล์ไม่หาย)
> หลัง reboot ต้อง login ด้วย `tuf.operation` (ทำอยู่แล้วเพื่อเปิด N8N) แล้วตรวจว่า OneDrive เปิดอยู่

**9.1** ตรวจ OneDrive และโฟลเดอร์:
```powershell
$Iface = "C:\Users\tuf.operation\OneDrive - Thai Union Group\Shortcuts\Digital Team - APAC Cluster #1 - Interface_Outbound"
Get-Process OneDrive -IncludeUserName -ErrorAction SilentlyContinue | Select-Object Id, UserName
Test-Path $Iface
Invoke-RestMethod "http://172.40.0.76:$ApiPort/api/check-share"
```
ต้องมี OneDrive ของ `THAIUNION\tuf.operation`, `Test-Path` = True และ `check-share` ได้ `success = True`

**9.2** ทดสอบว่าไฟล์ขึ้น SharePoint ถูกโฟลเดอร์:
```powershell
Set-Content "$Iface\_sap_autopr_test.txt" "test from 172.40.0.76"
```
เปิด SharePoint `SAP/Interface_Outbound` ภายใน 1–2 นาที ต้องเห็น `_sap_autopr_test.txt` แล้ว**ลบไฟล์ทดสอบ**:
```powershell
Remove-Item "$Iface\_sap_autopr_test.txt"
```

**9.3** ทดสอบจริงจากหน้าเว็บ: Send to Interface 1 ครั้ง แล้วตรวจว่าไฟล์ `SAP_PR_YYYYMMDD_HHMMSS.json` อยู่ใน `$Iface` และขึ้น SharePoint

---

## งานประจำหลัง Deploy

**ดูสถานะ**
```powershell
Get-ScheduledTask -TaskName SAP_AUTOPR-API | Select-Object TaskName, State
Get-Content C:\SAP_AUTOPR\logs\api.log -Tail 50 -Encoding UTF8
```

**Restart เฉพาะ API** (ไม่กระทบระบบอื่น) — รันขั้นที่ 0 ก่อน แล้ว:
```powershell
Stop-SapApi
Start-ScheduledTask -TaskName $TaskName; Start-Sleep -Seconds 8
Get-SapApiProcess | Select-Object ProcessId
Show-Neighbors
```

**อัปเดตหน้าเว็บ** (ไม่ต้อง restart อะไร):
```powershell
"login.html","index.html","master.html","history.html","auth-config.js" | ForEach-Object { Copy-Item "$Src\$_" $WebDir -Force }
```
แจ้งผู้ใช้ให้กด Ctrl+F5

**ไฟล์ `api.log`** จะโตขึ้นเรื่อยๆ ตรวจขนาดเป็นระยะ ถ้าต้องการล้าง ให้หยุด API (`Stop-SapApi`) ก่อน แล้วย้ายหรือเปลี่ยนชื่อไฟล์ จากนั้น `Start-ScheduledTask`

**หลัง reboot เครื่อง** (ทีม VisionIQ เป็นผู้แจ้ง): API เปิดเองจาก Task แต่ **N8N ต้องเปิดเองโดยทีม VisionIQ** ถ้า N8N ยังไม่เปิด การสแกน OCR จะใช้ไม่ได้

---

## ย้อนกลับ (Rollback)

ลบเฉพาะสิ่งที่ SAP PR สร้าง ไม่แตะระบบอื่น รันขั้นที่ 0 ก่อน แล้ว:
```powershell
# 1) API
Stop-SapApi
Unregister-ScheduledTask -TaskName "SAP_AUTOPR-API" -Confirm:$false

# 2) IIS
Stop-Website -Name "SAPPR"
Remove-Website -Name "SAPPR"
Remove-WebAppPool -Name "SAPPR"

# 3) Firewall (only our rules)
Remove-NetFirewallRule -DisplayName "SAP PR WEB 8080"
Remove-NetFirewallRule -DisplayName "SAP PR API 3001"

# 4) Check neighbours are untouched
Show-Neighbors
```
- โฟลเดอร์ `C:\SAP_AUTOPR` เก็บไว้ได้ (มีสำเนา JSON และ log) ลบเองภายหลังถ้าไม่ใช้แล้ว
- ฐานข้อมูล: `migration.sql` เป็นการเพิ่มคอลัมน์และตารางเท่านั้น ไม่ต้องย้อน

---

## แก้ปัญหาเบื้องต้น

| อาการ | ตรวจ |
|---|---|
| หน้าเว็บเปิดไม่ได้ | `Get-Website -Name SAPPR`, Firewall `SAP PR WEB 8080`, ขั้นที่ 8.1 |
| "ทดสอบ API" ไม่ผ่าน | `Get-ScheduledTask SAP_AUTOPR-API`, `api.log`, Firewall `SAP PR API 3001` |
| `test-db` FAIL | เครือข่ายไป `172.32.0.50:1433`, รหัส `sa` ใน `server.js` |
| สแกน OCR ไม่ได้ | N8N รันอยู่ไหม (`Show-Neighbors`), พอร์ต 5678 จากเครื่องผู้ใช้, WebHook ใน ProcessFlow, CORS (F12 → Console) |
| Send to Interface ไม่สำเร็จ | `check-share`, โฟลเดอร์ OneDrive Shortcut, สิทธิ์ของบัญชีที่รัน Task (ขั้นที่ 9) |
| ส่งสำเร็จแต่ไฟล์ไม่ขึ้น SharePoint | OneDrive ของ `tuf.operation` เปิดอยู่ไหม, บัญชีถูก sign out หรือไม่, ไอคอน OneDrive แสดง error sync หรือไม่ |
| ปุ่ม "แก้ไข / ส่งใหม่" แจ้งไม่พบไฟล์ | รายการที่ส่งก่อน deploy ไม่มีสำเนา หรือโฟลเดอร์ `sent-json` ไม่มีสิทธิ์เขียน |
| Task หยุดเอง | `api.log` บรรทัดท้าย, `Get-ScheduledTaskInfo SAP_AUTOPR-API` (LastTaskResult) |
| สร้าง Task ไม่ได้ (Access denied / logon failure) | รหัสผ่านบัญชีถูกไหม และบัญชีต้องมีสิทธิ์ "Log on as a batch job" (ผู้ดูแลระบบตั้งให้ได้) |
