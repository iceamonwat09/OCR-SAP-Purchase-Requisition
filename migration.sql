-- =====================================================
-- SAP PR Generator - Database Migration Script
-- เพิ่มคอลัมน์ tracking ใน Information + สร้างตาราง InterfaceHistory
-- Database: SAP_AUTOPR
-- =====================================================

USE SAP_AUTOPR;
GO

-- =====================================================
-- 1. เพิ่มคอลัมน์ CreatedBy, CreatedDate, UpdatedBy, UpdatedDate ในตาราง Information
-- =====================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Information') AND name = 'CreatedBy')
BEGIN
    ALTER TABLE Information ADD CreatedBy NVARCHAR(100) NULL;
    PRINT 'Added column: Information.CreatedBy';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Information') AND name = 'CreatedDate')
BEGIN
    ALTER TABLE Information ADD CreatedDate DATETIME NULL DEFAULT GETDATE();
    PRINT 'Added column: Information.CreatedDate';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Information') AND name = 'UpdatedBy')
BEGIN
    ALTER TABLE Information ADD UpdatedBy NVARCHAR(100) NULL;
    PRINT 'Added column: Information.UpdatedBy';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Information') AND name = 'UpdatedDate')
BEGIN
    ALTER TABLE Information ADD UpdatedDate DATETIME NULL;
    PRINT 'Added column: Information.UpdatedDate';
END
GO

-- =====================================================
-- 2. สร้างตาราง InterfaceHistory สำหรับเก็บประวัติ Send Interface
-- =====================================================

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('InterfaceHistory') AND type = 'U')
BEGIN
    CREATE TABLE InterfaceHistory (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        ScanFilename    NVARCHAR(500)   NOT NULL,   -- ชื่อไฟล์ที่ Scan (PDF)
        OutputFilename  NVARCHAR(500)   NOT NULL,   -- ชื่อไฟล์ output JSON
        CreatedDate     DATETIME        NOT NULL DEFAULT GETDATE(),  -- วันที่เวลา
        CreatedBy       NVARCHAR(100)   NOT NULL    -- User ที่ส่ง
    );
    PRINT 'Created table: InterfaceHistory';
END
GO

-- =====================================================
-- 3. สร้าง Index สำหรับการค้นหา
-- =====================================================

-- Index สำหรับค้นหา Master Data ตาม CreatedBy
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Information_CreatedBy' AND object_id = OBJECT_ID('Information'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Information_CreatedBy ON Information(CreatedBy);
    PRINT 'Created index: IX_Information_CreatedBy';
END
GO

-- Index สำหรับค้นหา History ตาม CreatedBy + CreatedDate
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_InterfaceHistory_CreatedBy_Date' AND object_id = OBJECT_ID('InterfaceHistory'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_InterfaceHistory_CreatedBy_Date ON InterfaceHistory(CreatedBy, CreatedDate);
    PRINT 'Created index: IX_InterfaceHistory_CreatedBy_Date';
END
GO

-- =====================================================
-- 4. เพิ่มคอลัมน์ Department ในตาราง Information
-- =====================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Information') AND name = 'Department')
BEGIN
    ALTER TABLE Information ADD Department NVARCHAR(100) NULL;
    PRINT 'Added column: Information.Department';
END
GO

-- Index สำหรับการค้นหาตาม Department
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Information_Department' AND object_id = OBJECT_ID('Information'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Information_Department ON Information(Department);
    PRINT 'Created index: IX_Information_Department';
END
GO

-- =====================================================
-- 5. สร้างตาราง ProcessFlow สำหรับเก็บ Webhook แต่ละ process
-- =====================================================

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('ProcessFlow') AND type = 'U')
BEGIN
    CREATE TABLE ProcessFlow (
        ID           INT IDENTITY(1,1) PRIMARY KEY,
        Description  NVARCHAR(200)  NOT NULL,   -- ชื่อ/คำอธิบาย process
        WebHook      NVARCHAR(500)  NOT NULL,   -- URL ของ webhook
        Remark       NVARCHAR(500)  NULL        -- หมายเหตุ
    );
    PRINT 'Created table: ProcessFlow';
END
GO

PRINT '✅ Migration completed successfully!';
GO
