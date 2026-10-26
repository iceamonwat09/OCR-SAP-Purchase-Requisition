# SAP PR Generator (OCR → SAP Purchase Requisition)

ระบบอ่านใบแจ้งหนี้ (PDF) ด้วย OCR ผ่าน N8N เติมข้อมูลบัญชีจากฐานข้อมูล Master แล้วสร้างไฟล์ JSON ตามโครงสร้าง SAP Purchase Requisition ไปวางที่โฟลเดอร์ Interface

Thai Union Group – IT Support | เวอร์ชันหน้าเว็บ 4.0

---

## 1. ภาพรวมระบบ

```
 เครื่องผู้ใช้ (เบราว์เซอร์)
   │
   │ ① เปิดหน้าเว็บ                http://172.40.0.76:8080/login.html (IIS เว็บ SAPPR)
   │ ② ส่ง PDF ไป OCR              http://172.40.0.76:5678/webhook/... (N8N)
   │ ③ ค้นหา / บันทึก / ส่งไฟล์       http://172.40.0.76:3001/api       (Node API)
   ▼
 ┌──────────────────── Server 172.40.0.76 ────────────────────┐
 │ IIS :8080      → เว็บ SAPPR (C:\SAP_AUTOPR\web)               │
 │                  login/index/master/history.html, auth-config │
 │ N8N :5678      → workflow OCR (Google Vertex) ใช้ร่วมกับ VisionIQ │
 │ VisionIQ :8000 → ระบบอื่น (ห้ามแตะ ดูหัวข้อ 11)               │
 │ Node API :3001 → server.js ──┬─► SQL Server (DB)              │
 │                              ├─► โฟลเดอร์ Interface (JSON)     │
 │                              └─► sent-json/YYYY-MM/ (สำเนา)    │
 └───────────────────────────────────────────────────────────────┘
 SQL Server : 172.32.0.50  (TUM-OD-DV0-50\SQLEXPRESS, database SAP_AUTOPR)
```

**สำคัญ:** โค้ดในหน้าเว็บทำงานในเบราว์เซอร์ของผู้ใช้ ดังนั้น URL ของ N8N และ API ที่ใส่ในระบบต้องเป็น IP ที่เครื่องผู้ใช้เข้าถึงได้ (`172.40.0.76`) ห้ามใช้ `localhost` หรือ `127.0.0.1`

| ส่วน | เครื่อง | พอร์ต | หมายเหตุ |
|---|---|---|---|
| ฐานข้อมูล SQL Server | 172.32.0.50 (`TUM-OD-DV0-50\SQLEXPRESS`) | 1433 | database `SAP_AUTOPR` |
| IIS (หน้าเว็บ) | 172.40.0.76 | 8080 | เว็บ `SAPPR` → `C:\SAP_AUTOPR\web`, Firewall rule "SAP PR WEB 8080" |
| Node API (`server.js`) | 172.40.0.76 | 3001 | `C:\SAP_AUTOPR\api`, Scheduled Task `SAP_AUTOPR-API`, Firewall rule "SAP PR API 3001" |
| N8N | 172.40.0.76 | 5678 | ของทีม VisionIQ ใช้ร่วมกัน เครื่องผู้ใช้ต้องเข้าถึงพอร์ตนี้ได้ |
| โฟลเดอร์ Interface | `D:\interface` บน 172.40.0.76 → Power Automate (ผ่าน Gateway) อัปโหลดไป SharePoint `DigitalTeam-APACCluster1/Shared Documents/SAP/Interface_Outbound` หลังไฟล์ถูกสร้าง 5 นาที แล้วย้ายต้นฉบับไป `D:\interface\Backup` | – | ระบบ SAP Interface อ่านไฟล์ JSON จาก SharePoint |

---

## 2. ไฟล์ในโปรเจค

| ไฟล์ | วางที่ | หน้าที่ |
|---|---|---|
| `login.html` | `C:\SAP_AUTOPR\web` | หน้า Login (Microsoft 365 SSO หรือ Guest) |
| `auth-config.js` | `C:\SAP_AUTOPR\web` | ค่า Azure AD สำหรับ SSO |
| `index.html` | `C:\SAP_AUTOPR\web` | OCR Generator: สแกน PDF, แก้ไข Item, ส่ง Interface |
| `master.html` | `C:\SAP_AUTOPR\web` | จัดการ Master Data (ตาราง `Information`) |
| `history.html` | `C:\SAP_AUTOPR\web` | ประวัติการส่ง Interface และส่งใหม่ |
| `server.js` | `C:\SAP_AUTOPR\api` (**นอกโฟลเดอร์เว็บ**) | Node.js API (Express) |
| `migration.sql` | – | สร้าง/เพิ่มคอลัมน์และตาราง (รันครั้งเดียว รันซ้ำได้) |
| `update-processflow.sql` | – | (ไม่บังคับ) เปลี่ยน `ProcessFlow.WebHook` ให้ชี้ไป N8N `172.40.0.76` ใช้เฉพาะเมื่อในตารางยังเป็น URL เดิม |
| `DEPLOY.md` | – | คู่มือ Deploy บน Server 172.40.0.76 ทีละขั้นแบบปลอดภัย |

> **ห้ามวาง `server.js` ในโฟลเดอร์เว็บของ IIS** เพราะในไฟล์มีรหัสผ่าน SQL และ IIS จะเปิดให้ดาวน์โหลดไฟล์ `.js` ได้

Package ที่ API ใช้: `express` 4.x, `mssql`, `cors` ติดตั้งใน `C:\SAP_AUTOPR\api` ด้วย `npm install express@4 mssql cors` (ห้ามใช้ `-g`)

---

## 3. การเข้าสู่ระบบ (`login.html`, `auth-config.js`)

- **Guest:** ปุ่ม "Guest" เก็บข้อมูลผู้ใช้เป็น `username = "System"` (`isGuest: true`)
  - ผู้ใช้ `System` เห็น Master Data และประวัติการส่ง **ของทุกคน**
- **Microsoft 365 SSO:** ใช้ MSAL.js (โหลดจาก `alcdn.msauth.net`)
  - ใช้ได้เมื่อใส่ `TENANT_ID` และ `CLIENT_ID` ใน `auth-config.js` แล้ว
  - **ปัจจุบันยังเป็นค่าตัวอย่าง (`YOUR_TENANT_ID`) หน้า login จึงซ่อนปุ่ม SSO และแสดงเฉพาะ Guest**
  - ถ้าจะเปิดใช้ ต้องลงทะเบียน App ใน Azure (ประเภท SPA) และตั้ง `REDIRECT_URI` ให้ตรงกับ URL จริงของ `login.html`
  - ผู้ใช้ SSO เห็นเฉพาะข้อมูลที่ตัวเองสร้าง (กรองจาก `CreatedBy`)
- ข้อมูล login เก็บใน `sessionStorage` (ปิดแท็บแล้วหาย) และหมดอายุใน 8 ชั่วโมง ทุกหน้าตรวจสอบและพากลับไป `login.html` เมื่อไม่มีหรือหมดอายุ

---

## 4. หน้าที่และฟีเจอร์

### 4.1 OCR Generator (`index.html`)

**ส่วนตั้งค่า**
- **Process Flow** (dropdown): ดึงจากตาราง `ProcessFlow` เมื่อเลือกแล้วช่อง "OCR Webhook URL" จะเปลี่ยนเป็น `WebHook` ของรายการนั้น
- **Database API URL**: ค่าตั้งต้น `http://172.40.0.76:3001/api`
- **OCR Webhook URL**: ค่าตั้งต้น `http://172.40.0.76:5678/webhook/7c4fd4bc-c51f-4890-b6ab-86dfad5ce8f9`
- **รูปแบบการดึงข้อมูล**: ตาม S/N (ค่าเริ่มต้น) หรือ ตาม Department

**ขั้นตอนหลัก**
1. เลือก/ลากไฟล์ PDF (หลายไฟล์ได้ ไฟล์ละไม่เกิน 20 MB) แล้วกด "เริ่มสแกน OCR"
   - ส่งทีละไฟล์ไปที่ OCR Webhook (field `pdf`) หน่วง 5 วินาทีระหว่างไฟล์
   - N8N ต้องตอบกลับ `{ "success": true, "invoice": { ... } }`
2. แสดงผลทีละไฟล์ (ปุ่ม ก่อนหน้า/ถัดไป) ค่าที่แก้บนหน้าจอจะถูกจำไว้เมื่อเปลี่ยนไฟล์
3. เติมข้อมูลบัญชีจาก Master
   - **ตาม S/N**: ปุ่ม "ค้นหาและเติมข้อมูล" ใช้ S/N ของแต่ละ Item (แยกจากข้อความ `S/N: xxx` หรือพิมพ์ในช่อง S/N) เติมเฉพาะช่องที่ว่าง ยกเว้น Req Track ที่แทนที่เสมอ (ค่าเดิมย้ายไปช่อง Inv)
   - **ตาม Department**: เลือก Department → Cost / IO / GL (ต้องเลือกครบ 4 ช่อง) → กด "ดึงข้อมูล" ค่าจะไปอยู่ใน "ค่าเริ่มต้น" แล้วกด "ใช้ค่าเริ่มต้น" เพื่อเติมให้ทุก Item (เติมเฉพาะช่องที่ว่าง)
4. แก้ไขรายการ: เพิ่ม Item (➕), ลบ Item (🗑️), แก้ทุกช่อง, Amount = Price × Qty คำนวณอัตโนมัติ
5. กรอก **Email ผู้ขอ** (กรอกเฉพาะส่วนหน้า `@thaiunion.com`) **บังคับกรอกก่อน Send to Interface**
6. ปุ่มส่งออก
   - **Preview / Download JSON**: JSON ของไฟล์ที่แสดงอยู่
   - **CSV**: รวมทุกไฟล์ที่สแกนสำเร็จ ใช้ค่าที่แก้บนหน้าจอ
   - **Send to Interface**: ส่ง JSON ไปที่ API → บันทึกไฟล์ `SAP_PR_YYYYMMDD_HHMMSS.json` (เวลาไทย)
   - **กันส่งซ้ำ**: ไฟล์ PDF ที่ส่งแล้ว ปุ่มจะเป็น "✅ ส่งแล้ว" และกดไม่ได้ server เช็คชื่อ PDF กับ `InterfaceHistory` อีกชั้น (อ่านอย่างเดียว) ถ้าเคยส่งแล้วจะไม่เขียนไฟล์ ใช้ได้ทั้งกรณีรีเฟรชหรือเปิดหลายแท็บ ส่วนโหมด Department ที่ไม่ได้สแกน PDF จะกันในหน้าเว็บจนกว่าจะดึงข้อมูล Department ใหม่
7. **ส่งใหม่จากประวัติ**: เปิดด้วย `index.html?resendId=<ID>` (จากปุ่มในหน้า Send History) โหลด JSON ที่เคยส่งมาให้แก้ แล้ว Send ใหม่ ระบบสร้างไฟล์ใหม่ ไฟล์เดิมไม่ถูกแก้ ต้องกรอก Email ใหม่ **เป็นทางเดียวที่ส่ง PDF เดิมซ้ำได้** และส่งได้ 1 ครั้งต่อการเปิด

### 4.2 Master Data (`master.html`)
- ตาราง `Information` ค้นหาตาม Serial / Cost Center / IO / GL, **กรองตาม Plant**, แบ่งหน้า 50 แถว
- เพิ่ม / แก้ไข / ลบ (Serial ห้ามซ้ำ, แก้ Serial ไม่ได้) มีคอลัมน์ **Department**
- ผู้ใช้ `System` (Guest) เห็นทุกแถว ผู้ใช้อื่นเห็นเฉพาะแถวที่ตัวเองสร้าง

### 4.3 Send History (`history.html`)
- รายการจากตาราง `InterfaceHistory` กรองตามช่วงวันที่ (ที่ server) และ **ชื่อไฟล์ Output** (บางส่วนของชื่อ ไม่สนตัวพิมพ์) แบ่งหน้า 50 แถว
- ปุ่ม **แก้ไข / ส่งใหม่** ต่อแถว ใช้ได้กับรายการที่ส่งหลังเปิดใช้ระบบเก็บสำเนา (`sent-json`) เท่านั้น

---

## 5. โครงสร้าง JSON ที่ส่ง Interface

```json
{
  "PurchaseRequisitionType": "NB",
  "PurReqnDescription": "...",
  "to_PurchaseReqnItem": [
    {
      "Plant": "1010",
      "PurchaseRequisitionItemText": "E2520AC S/N: CSLM28736 (B/W)",
      "AccountAssignmentCategory": "Y",
      "RequestedQuantity": "4144.00",
      "BaseUnit": "PC",
      "PurchasingOrganization": "C003",
      "PurchasingGroup": "C39",
      "MaterialGroup": "9215",
      "PurchaseRequisitionPrice": "0.17",
      "PurReqnItemCurrency": "THB",
      "RequirementTracking": "KRIT",
      "RequisitionerName": "IT07",
      "DeliveryDate": "/Date(1752019200000)/",
      "to_PurchaseReqnAcctAssgmt": [
        { "GLAccount": "56220020", "CostCenter": "1010699904", "OrderID": "E101CORP01" }
      ],
      "to_PurchaseReqnItemText": [
        { "DocumentText": "B06", "Language": "EN", "NoteDescription": "Email : name@thaiunion.com" }
      ]
    }
  ]
}
```
- `to_PurchaseReqnItemText` (Email ผู้ขอ) ใส่ **ทุก Item** ใช้ให้ Workflow ส่งเมลแจ้งเมื่อ PR ถูก reject (SAP รองรับ Note เฉพาะระดับ Item ไม่มีระดับ Header)
- ใน Preview / Download จะมี `to_PurchaseReqnItemText` เมื่อกรอก Email แล้วเท่านั้น

---

## 6. API (`server.js`, พอร์ต 3001, prefix `/api`)

| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/health` | ตรวจว่า API ทำงาน |
| GET | `/test-db` | ทดสอบการเชื่อมต่อฐานข้อมูล |
| GET | `/check-share` | ทดสอบการเข้าถึงโฟลเดอร์ Interface |
| POST | `/search-serial` | ค้นหา 1 Serial `{ serial }` |
| POST | `/search-serials` | ค้นหาหลาย Serial `{ serials: [] }` |
| POST | `/save-file` | บันทึก JSON ไปโฟลเดอร์ Interface + สำเนา `sent-json/YYYY-MM/` + บันทึก `InterfaceHistory` `{ filename, content, scanFilename, user, resendId? }` ถ้า `scanFilename` เคยส่งแล้วตอบ **409** (`alreadySent`) ยกเว้นมี `resendId` ของ PDF เดียวกัน ถ้าเช็คประวัติไม่ได้ (DB ล่ม) ตอบ **503** และไม่ส่ง |
| GET | `/master/list?user=` | รายการ Master |
| GET | `/master/search?q=&field=serial\|cost\|io\|gl&user=` | ค้นหา Master |
| POST | `/master/create` | เพิ่ม Master |
| PUT | `/master/update` | แก้ไข Master |
| DELETE | `/master/delete` | ลบ Master `{ serial }` |
| GET | `/processflow/list` | รายการ Process Flow |
| GET | `/department/list` | Department ทั้งหมด (DISTINCT) |
| GET | `/department/options?department=` | Cost / IO / GL ของ Department |
| POST | `/department/search` | ข้อมูลตาม `{ department, cost, io, gl }` (ต้องครบ 4 ค่า) |
| GET | `/history?user=&startDate=&endDate=` | ประวัติการส่ง |
| GET | `/history/:id?user=` | JSON ที่เคยส่ง (อ่านจาก `sent-json`) สำหรับส่งใหม่ |

- รับ body JSON สูงสุด 10 MB
- สิทธิ์: ถ้า `user` ไม่ใช่ `System` จะเห็นเฉพาะข้อมูลที่ `CreatedBy` ตรงกัน (เทียบแบบไม่สนตัวพิมพ์ใน `/history/:id`)

---

## 7. ฐานข้อมูล (`SAP_AUTOPR`)

**`Information`** (Master Data – ตารางเดิม)
`SERIAL`, `Plant`, `Detail_Model`, `Type`, `Cost`, `IO`, `GL`, `BaseUnit`, `PurchasingOrganization`, `PurchasingGroup`, `MaterialGroup`, `RequirementTracking`, `Requisitioner`, `Department`*, `CreatedBy`*, `CreatedDate`*, `UpdatedBy`*, `UpdatedDate`*

**`InterfaceHistory`*** – `ID` (PK), `ScanFilename`, `OutputFilename`, `CreatedDate`, `CreatedBy`

**`ProcessFlow`*** – `ID` (PK), `Description` (ชื่อใน dropdown), `WebHook` (URL ของ N8N), `Remark`

\* สร้างหรือเพิ่มโดย `migration.sql` (มี `IF NOT EXISTS` รันซ้ำได้)

Webhook ของ N8N ที่ใช้อยู่ (ต้องอยู่ใน `ProcessFlow.WebHook`):
- `http://172.40.0.76:5678/webhook/f471b783-9536-45d5-b8bb-99f4b8778cbe`
- `http://172.40.0.76:5678/webhook/7c4fd4bc-c51f-4890-b6ab-86dfad5ce8f9`

---

## 8. ค่าที่ต้องตั้งตามสภาพแวดล้อม

| ไฟล์ | ตัวแปร / ตำแหน่ง | ค่าปัจจุบัน |
|---|---|---|
| `server.js` | `PORT` | `3001` |
| `server.js` | `sqlConfig.server` / `database` | `TUM-OD-DV0-50\SQLEXPRESS` / `SAP_AUTOPR` |
| `server.js` | `INTERFACE_PATH` | `D:\interface` (Power Automate อัปโหลดไป SharePoint `SAP/Interface_Outbound`) |
| `server.js` | `ARCHIVE_PATH` | `<โฟลเดอร์ของ server.js>\sent-json` |
| `index.html` | ช่อง `apiUrl` | `http://172.40.0.76:3001/api` |
| `index.html` | ช่อง `webhookUrl` | `http://172.40.0.76:5678/webhook/7c4fd4bc-...` |
| `master.html`, `history.html` | `API_URL` | `http://172.40.0.76:3001/api` |
| `auth-config.js` | `TENANT_ID`, `CLIENT_ID`, `REDIRECT_URI` | ยังเป็นค่าตัวอย่าง (SSO ปิดอยู่) |
| ตาราง `ProcessFlow` | `WebHook` | ต้องเป็น `http://172.40.0.76:5678/webhook/<path>` |

---

## 9. ติดตั้งและรัน (สรุป)

ขั้นตอนละเอียดพร้อมคำสั่งทั้งหมดอยู่ใน [DEPLOY.md](DEPLOY.md)

ทุกขั้นต้องทำตามข้อตกลงในหัวข้อ 11

1. รัน `migration.sql` บนฐานข้อมูล `SAP_AUTOPR` (ทำแล้ว)
2. ใส่ข้อมูล `ProcessFlow` ให้ `WebHook` ชี้ไป N8N `172.40.0.76:5678`
3. **API:** วาง `server.js` ที่ `C:\SAP_AUTOPR\api` แล้ว `npm install express@4 mssql cors` เช็คพอร์ตก่อนรันด้วย `netstat -ano -p TCP | findstr ":3001"`
4. ตั้ง Scheduled Task ชื่อ **`SAP_AUTOPR-API`** ให้รัน `node server.js` ตอนเครื่องเปิด ใช้บัญชีที่เขียนโฟลเดอร์ Interface ได้
5. **หน้าเว็บ:** วาง 5 ไฟล์ที่ `C:\SAP_AUTOPR\web` แล้วสร้างเว็บ IIS ชื่อ `SAPPR` binding `*:8080:` (ไม่แตะ Default Web Site และเว็บ VisionIQ)
6. Firewall: `SAP PR API 3001` (ทำแล้ว) และ `SAP PR WEB 8080` (เพิ่ม rule ใหม่ ห้ามแก้ rule เดิม)
7. ตรวจ: `/api/health`, `/api/test-db`, `/api/processflow/list`, `/api/check-share` และตรวจว่า VisionIQ (`:8000/artwork_check`) และ N8N ยังปกติ
8. Webhook node ใน N8N ต้อง Publish แล้ว และถ้าเบราว์เซอร์ขึ้น CORS error ให้ตั้ง Allowed Origins = `*`

---

## 10. ข้อจำกัดที่ทราบ

- API ไม่มีการยืนยันตัวตนฝั่ง server ค่า `user` ส่งมาจากหน้าเว็บ
- รหัสผ่าน SQL เขียนอยู่ใน `server.js`
- ชื่อไฟล์ส่ง Interface ละเอียดถึงวินาที ถ้าส่งในวินาทีเดียวกันไฟล์จะทับกัน
- ประวัติที่ส่งก่อนเปิดใช้ `sent-json` ไม่มีสำเนา จึงกด "ส่งใหม่" ไม่ได้
- Node API ต้องรันตลอดเวลา (ใช้ Scheduled Task `SAP_AUTOPR-API`)
- N8N ใช้ร่วมกับ VisionIQ และไม่ได้เปิดเองหลัง reboot ถ้า N8N หยุด การสแกน OCR จะใช้ไม่ได้
- "Send to Interface สำเร็จ" หมายถึงไฟล์ถูกเขียนลง `D:\interface` แล้ว ไฟล์จะขึ้น SharePoint หลังจากนั้นประมาณ 5 นาทีขึ้นไป (ขึ้นกับรอบของ Power Automate) ถ้า Power Automate หรือ Gateway หยุด ไฟล์จะค้างใน `D:\interface`

---

## 11. ข้อตกลงการใช้ Server 172.40.0.76 ร่วมกับ VisionIQ และ N8N

Server นี้มีระบบอื่นรันอยู่: **VisionIQ** (python, พอร์ต 8000) และ **N8N** (node, พอร์ต 5678/5679) ห้ามทำให้ทั้งสองระบบได้รับผลกระทบ

**ห้ามเด็ดขาด**
1. ห้ามใช้ `taskkill /IM node.exe` หรือ `taskkill /IM python.exe` จะปิด N8N หรือ VisionIQ ไปด้วย ถ้าต้องหยุด API ของเรา ใช้ `Stop-ScheduledTask SAP_AUTOPR-API` หรือ `taskkill /PID <pid>` ที่ตรวจแล้วว่าเป็น `server.js` ของเรา
2. ห้ามแก้หรือลบ Scheduled Task `VisionIQ-Waitress` Task ของเราชื่อ `SAP_AUTOPR-API`
3. ห้ามใช้พอร์ต 8000, 5678, 5679 สำหรับเปิดบริการของเรา (API ใช้ 3001, หน้าเว็บใช้ 8080) เช็คก่อนใช้ทุกครั้งด้วย `netstat -ano -p TCP | findstr ":<port>"`

**เช็คก่อนทำ**
4. SQL Server 172.32.0.50: ใช้ database `SAP_AUTOPR` เท่านั้น (VisionIQ ใช้ database `VisionIQ`) ห้ามรัน query หนักหรือค้าง lock นาน
5. Firewall: ห้ามลบ rule `VisionIQ HTTP 8000` เพิ่ม rule ของเราแยกเท่านั้น
6. Node/npm: ใช้ Node ที่มีอยู่ ห้ามติดตั้ง Node ใหม่ ใช้ nvm หรือแก้ PATH เพราะ N8N ติดตั้งแบบ npm global ในบัญชี `tuf.operation` ติดตั้ง package เฉพาะใน `C:\SAP_AUTOPR\api` (ห้าม `-g`)
7. ห้ามเปิด Hyper-V หรือติดตั้ง Docker Desktop โดยไม่แจ้ง

**ทั่วไป**
8. ไฟล์ทั้งหมดของ SAP PR อยู่ใน `C:\SAP_AUTOPR\` เท่านั้น ยกเว้นโฟลเดอร์ส่ง Interface `D:\interface` ที่ Power Automate อ่าน ห้ามแตะ `C:\VisionIQ\` และเว็บ IIS อื่น (Default Web Site, VisionIQ)
9. ถ้าต้อง restart เครื่อง ต้องแจ้งทีม VisionIQ ก่อนเสมอ เพราะ N8N ต้องเปิดเองหลัง reboot
