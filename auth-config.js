// ============================================================
//  Azure AD Configuration - SSO O365
//  ให้ IT แก้ไขค่าด้านล่างนี้หลังจาก Register App ใน Azure Portal
// ============================================================
//
//  ขั้นตอนสำหรับ IT:
//  1. ไปที่ Azure Portal > Azure Active Directory > App registrations
//  2. กด "+ New registration"
//  3. ตั้งชื่อ App: "SAP PR Generator"
//  4. Supported account types: "Accounts in this organizational directory only"
//  5. Redirect URI: เลือก "Single-page application (SPA)" แล้วใส่ URL ของ login.html
//  6. หลัง Register แล้ว copy Tenant ID และ Client ID มาใส่ด้านล่าง
//
// ============================================================

const AUTH_CONFIG = {
    // === ค่าที่ IT ต้องแก้ไข ===
    TENANT_ID: "YOUR_TENANT_ID",           // เช่น "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    CLIENT_ID: "YOUR_CLIENT_ID",           // เช่น "12345678-abcd-efgh-ijkl-123456789012"
    REDIRECT_URI: "http://localhost/login.html",  // URL ที่เปิดหน้า login.html

    // === ค่าคงที่ (ไม่ต้องแก้) ===
    AUTHORITY_BASE: "https://login.microsoftonline.com/",
    SCOPES: ["User.Read"],
    CACHE_LOCATION: "sessionStorage",
    APP_NAME: "SAP PR Generator",
    APP_VERSION: "4.0"
};
