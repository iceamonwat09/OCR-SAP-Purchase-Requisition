-- =====================================================
-- SAP PR Generator - ชี้ ProcessFlow.WebHook ไปที่ N8N บน Server ใหม่
-- Server ใหม่: 172.40.0.76 (N8N port 5678)
-- จับคู่แถวจาก path ของ webhook จึงไม่ต้องระบุ ID
-- รันซ้ำได้ปลอดภัย
-- =====================================================

USE SAP_AUTOPR;
GO

SET NOCOUNT ON;

PRINT '--- ก่อนแก้ไข ---';
SELECT ID, Description, WebHook FROM ProcessFlow ORDER BY ID;

DECLARE @NewBase NVARCHAR(100) = N'http://172.40.0.76:5678/webhook/';

DECLARE @Paths TABLE (WebhookPath NVARCHAR(100));
INSERT INTO @Paths (WebhookPath) VALUES
    (N'f471b783-9536-45d5-b8bb-99f4b8778cbe'),
    (N'7c4fd4bc-c51f-4890-b6ab-86dfad5ce8f9');

BEGIN TRANSACTION;

UPDATE pf
SET WebHook = @NewBase + p.WebhookPath
FROM ProcessFlow pf
JOIN @Paths p ON pf.WebHook LIKE N'%/webhook/' + p.WebhookPath;

PRINT CONCAT('จำนวนแถวที่แก้ไข: ', @@ROWCOUNT);

COMMIT TRANSACTION;

PRINT '--- หลังแก้ไข ---';
SELECT ID, Description, WebHook FROM ProcessFlow ORDER BY ID;

-- path ที่ยังไม่มีในตาราง (ถ้ามีผลลัพธ์ ต้อง INSERT เพิ่มเอง ดูตัวอย่างด้านล่าง)
PRINT '--- path ที่ยังไม่มีใน ProcessFlow ---';
SELECT p.WebhookPath AS PathNotInProcessFlow
FROM @Paths p
WHERE NOT EXISTS (SELECT 1 FROM ProcessFlow pf WHERE pf.WebHook LIKE N'%/webhook/' + p.WebhookPath);

-- แถวที่ยังชี้ไปเครื่องเดิมหรือ localhost (ถ้ามีผลลัพธ์ ต้องตรวจสอบ)
PRINT '--- แถวที่ยังไม่ได้ชี้ไป 172.40.0.76 ---';
SELECT ID, Description, WebHook
FROM ProcessFlow
WHERE WebHook NOT LIKE @NewBase + N'%';
GO

-- ตัวอย่าง INSERT สำหรับ path ที่ยังไม่มีในตาราง (แก้ Description ให้ผู้ใช้เข้าใจ แล้วรันเฉพาะส่วนนี้)
-- INSERT INTO ProcessFlow (Description, WebHook, Remark)
-- VALUES (N'<ชื่อที่แสดงใน dropdown>', N'http://172.40.0.76:5678/webhook/<path>', N'');
