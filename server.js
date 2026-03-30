/**
 * SAP PR Generator - API Server
 * เชื่อมต่อ SQL Server เพื่อค้นหาข้อมูล Serial Number
 * 
 * Thai Union Group - IT Support
 */

const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors()); // อนุญาต cross-origin requests
app.use(express.json());

// SQL Server Configuration
const sqlConfig = {
    server: 'TUM-OD-DV0-50\\SQLEXPRESS',
    database: 'SAP_AUTOPR',
    user: 'sa',
    password: 'P@ssw0rd',
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    },
    connectionTimeout: 30000,
    requestTimeout: 30000
};

// Connection Pool
let pool = null;

async function getPool() {
    if (!pool) {
        pool = await sql.connect(sqlConfig);
        console.log('✅ Connected to SQL Server');
    }
    return pool;
}

const fs = require('fs');
const path = require('path');

// ==================== Configuration ====================

// Network Share Path สำหรับบันทึกไฟล์ JSON
const INTERFACE_PATH = '\\\\172.32.201.106\\Interface Onedrive$';

// ==================== API Endpoints ====================

/**
 * Health Check
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        service: 'SAP PR Generator API'
    });
});

/**
 * บันทึกไฟล์ JSON ไปยัง Network Share + บันทึกประวัติลง DB
 * POST /api/save-file
 * Body: { "filename": "SAP_PR_xxx.json", "content": { ... }, "scanFilename": "invoice.pdf", "user": "user@email.com" }
 */
app.post('/api/save-file', async (req, res) => {
    try {
        const { filename, content, scanFilename, user } = req.body;

        if (!filename || !content) {
            return res.status(400).json({
                success: false,
                message: 'กรุณาระบุ filename และ content'
            });
        }

        // สร้าง safe filename (ป้องกัน path traversal)
        const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9_\-\.]/g, '_');

        // ตรวจสอบว่าเป็นไฟล์ .json
        if (!safeFilename.endsWith('.json')) {
            return res.status(400).json({
                success: false,
                message: 'รองรับเฉพาะไฟล์ .json เท่านั้น'
            });
        }

        const filePath = path.join(INTERFACE_PATH, safeFilename);
        const jsonContent = JSON.stringify(content, null, 2);

        console.log(`📁 Saving file: ${filePath}`);

        // บันทึกไฟล์
        fs.writeFileSync(filePath, jsonContent, 'utf8');

        console.log(`✅ File saved: ${safeFilename}`);

        // บันทึกประวัติ Send Interface ลง Database
        try {
            const pool = await getPool();
            await pool.request()
                .input('scanFilename', sql.NVarChar, scanFilename || '')
                .input('outputFilename', sql.NVarChar, safeFilename)
                .input('createdBy', sql.NVarChar, user || 'Unknown')
                .query(`
                    INSERT INTO InterfaceHistory (ScanFilename, OutputFilename, CreatedDate, CreatedBy)
                    VALUES (@scanFilename, @outputFilename, GETDATE(), @createdBy)
                `);
            console.log(`📝 Interface history logged for: ${safeFilename}`);
        } catch (logError) {
            // ไม่ block การส่งไฟล์ ถ้า log ล้มเหลว
            console.error('⚠️ Failed to log interface history:', logError.message);
        }

        res.json({
            success: true,
            message: `บันทึกไฟล์สำเร็จ: ${safeFilename}`,
            filename: safeFilename,
            path: filePath
        });

    } catch (error) {
        console.error('❌ Save file error:', error.message);

        let errorMessage = 'ไม่สามารถบันทึกไฟล์ได้';
        if (error.code === 'ENOENT') {
            errorMessage = 'ไม่พบโฟลเดอร์ปลายทาง - ตรวจสอบ Network Share';
        } else if (error.code === 'EACCES') {
            errorMessage = 'ไม่มีสิทธิ์เขียนไฟล์ - ตรวจสอบ Permission';
        } else if (error.code === 'ENOTFOUND' || error.message.includes('network')) {
            errorMessage = 'ไม่สามารถเชื่อมต่อ Network Share ได้';
        }

        res.status(500).json({
            success: false,
            message: errorMessage,
            error: error.message
        });
    }
});

/**
 * ตรวจสอบการเชื่อมต่อ Network Share
 * GET /api/check-share
 */
app.get('/api/check-share', (req, res) => {
    try {
        // ตรวจสอบว่าเข้าถึง folder ได้ไหม
        if (fs.existsSync(INTERFACE_PATH)) {
            const files = fs.readdirSync(INTERFACE_PATH);
            res.json({
                success: true,
                message: '✅ เชื่อมต่อ Network Share สำเร็จ',
                path: INTERFACE_PATH,
                fileCount: files.length
            });
        } else {
            throw new Error('Path not found');
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '❌ ไม่สามารถเชื่อมต่อ Network Share',
            path: INTERFACE_PATH,
            error: error.message
        });
    }
});

/**
 * ค้นหาข้อมูลจาก Serial Number
 * POST /api/search-serial
 * Body: { "serial": "CSHN63791" }
 */
app.post('/api/search-serial', async (req, res) => {
    try {
        const { serial } = req.body;
        
        if (!serial) {
            return res.status(400).json({
                success: false,
                message: 'กรุณาระบุ Serial Number'
            });
        }

        console.log(`🔍 Searching for Serial: ${serial}`);

        const pool = await getPool();
        const result = await pool.request()
            .input('serial', sql.NVarChar, serial)
            .query(`
                SELECT 
                    SERIAL,
                    Plant,
                    Detail_Model,
                    Type,
                    Cost,
                    IO,
                    GL,
                    BaseUnit,
                    PurchasingOrganization,
                    PurchasingGroup,
                    MaterialGroup,
                    RequirementTracking,
                    Requisitioner
                FROM Information 
                WHERE SERIAL = @serial
            `);

        if (result.recordset.length > 0) {
            const data = result.recordset[0];
            console.log(`✅ Found: ${serial}`);
            
            res.json({
                success: true,
                data: {
                    SERIAL: data.SERIAL,
                    Plant: data.Plant || '',
                    Detail_Model: data.Detail_Model || '',
                    Type: data.Type || '',
                    CostCenter: data.Cost || '',
                    OrderID: data.IO || '',
                    GLAccount: data.GL || '',
                    BaseUnit: data.BaseUnit || '',
                    PurchasingOrganization: data.PurchasingOrganization || '',
                    PurchasingGroup: data.PurchasingGroup || '',
                    MaterialGroup: data.MaterialGroup || '',
                    RequirementTracking: data.RequirementTracking || '',
                    Requisitioner: data.Requisitioner || ''
                }
            });
        } else {
            console.log(`❌ Not found: ${serial}`);
            res.json({
                success: false,
                message: `ไม่พบข้อมูล Serial: ${serial}`
            });
        }

    } catch (error) {
        console.error('❌ Database Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล',
            error: error.message
        });
    }
});

/**
 * ค้นหาหลาย Serial พร้อมกัน
 * POST /api/search-serials
 * Body: { "serials": ["CSHN63791", "CSHN63792"] }
 */
app.post('/api/search-serials', async (req, res) => {
    try {
        const { serials } = req.body;
        
        if (!serials || !Array.isArray(serials) || serials.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'กรุณาระบุ Serial Numbers เป็น array'
            });
        }

        console.log(`🔍 Searching for ${serials.length} serials`);

        const pool = await getPool();
        
        // สร้าง parameterized query สำหรับหลาย serial
        const serialList = serials.map((s, i) => `@serial${i}`).join(',');
        const request = pool.request();
        serials.forEach((s, i) => {
            request.input(`serial${i}`, sql.NVarChar, s);
        });

        const result = await request.query(`
            SELECT 
                SERIAL,
                Plant,
                Detail_Model,
                Type,
                Cost,
                IO,
                GL,
                BaseUnit,
                PurchasingOrganization,
                PurchasingGroup,
                MaterialGroup,
                RequirementTracking,
                Requisitioner
            FROM Information 
            WHERE SERIAL IN (${serialList})
        `);

        const dataMap = {};
        result.recordset.forEach(row => {
            dataMap[row.SERIAL] = {
                SERIAL: row.SERIAL,
                Plant: row.Plant || '',
                Detail_Model: row.Detail_Model || '',
                Type: row.Type || '',
                CostCenter: row.Cost || '',
                OrderID: row.IO || '',
                GLAccount: row.GL || '',
                BaseUnit: row.BaseUnit || '',
                PurchasingOrganization: row.PurchasingOrganization || '',
                PurchasingGroup: row.PurchasingGroup || '',
                MaterialGroup: row.MaterialGroup || '',
                RequirementTracking: row.RequirementTracking || '',
                Requisitioner: row.Requisitioner || ''
            };
        });

        console.log(`✅ Found ${Object.keys(dataMap).length} of ${serials.length} serials`);

        res.json({
            success: true,
            found: Object.keys(dataMap).length,
            total: serials.length,
            data: dataMap
        });

    } catch (error) {
        console.error('❌ Database Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล',
            error: error.message
        });
    }
});

/**
 * ทดสอบการเชื่อมต่อ Database
 * GET /api/test-db
 */
app.get('/api/test-db', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT TOP 1 SERIAL FROM Information');
        
        res.json({
            success: true,
            message: '✅ เชื่อมต่อ Database สำเร็จ',
            sample: result.recordset[0] || null
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '❌ ไม่สามารถเชื่อมต่อ Database',
            error: error.message
        });
    }
});

// ==================== Master Data Management APIs ====================

/**
 * ดึงรายการ Master Data
 * GET /api/master/list?user=xxx
 * ถ้า user=System จะดึงทั้งหมด, ถ้าไม่ใช่จะดึงเฉพาะของ user นั้น
 */
app.get('/api/master/list', async (req, res) => {
    try {
        const { user } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let query = `
            SELECT SERIAL, Plant, Detail_Model, Type, Cost, IO, GL,
                   BaseUnit, PurchasingOrganization, PurchasingGroup,
                   MaterialGroup, RequirementTracking, Requisitioner,
                   CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
            FROM Information
        `;

        if (user && user !== 'System') {
            query += ` WHERE CreatedBy = @user`;
            request.input('user', sql.NVarChar, user);
        }

        query += ` ORDER BY CreatedDate DESC`;

        const result = await request.query(query);

        res.json({
            success: true,
            total: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        console.error('❌ Master list error:', error.message);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการดึงข้อมูล',
            error: error.message
        });
    }
});

/**
 * ค้นหา Master Data ด้วย Serial, Cost, IO, GL
 * GET /api/master/search?q=xxx&field=serial|cost|io|gl&user=xxx
 */
app.get('/api/master/search', async (req, res) => {
    try {
        const { q, field, user } = req.query;

        if (!q) {
            return res.status(400).json({
                success: false,
                message: 'กรุณาระบุคำค้นหา'
            });
        }

        const pool = await getPool();
        const request = pool.request();
        request.input('q', sql.NVarChar, `%${q}%`);

        const fieldMap = {
            serial: 'SERIAL',
            cost: 'Cost',
            io: 'IO',
            gl: 'GL'
        };

        const dbField = fieldMap[field] || 'SERIAL';

        let query = `
            SELECT SERIAL, Plant, Detail_Model, Type, Cost, IO, GL,
                   BaseUnit, PurchasingOrganization, PurchasingGroup,
                   MaterialGroup, RequirementTracking, Requisitioner,
                   CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
            FROM Information
            WHERE ${dbField} LIKE @q
        `;

        if (user && user !== 'System') {
            query += ` AND CreatedBy = @user`;
            request.input('user', sql.NVarChar, user);
        }

        query += ` ORDER BY CreatedDate DESC`;

        const result = await request.query(query);

        res.json({
            success: true,
            total: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        console.error('❌ Master search error:', error.message);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการค้นหา',
            error: error.message
        });
    }
});

/**
 * เพิ่ม Master Data
 * POST /api/master/create
 */
app.post('/api/master/create', async (req, res) => {
    try {
        const {
            SERIAL, Plant, Detail_Model, Type, Cost, IO, GL,
            BaseUnit, PurchasingOrganization, PurchasingGroup,
            MaterialGroup, RequirementTracking, Requisitioner, user
        } = req.body;

        if (!SERIAL) {
            return res.status(400).json({
                success: false,
                message: 'กรุณาระบุ Serial Number'
            });
        }

        const pool = await getPool();

        // ตรวจสอบ Serial ซ้ำ
        const check = await pool.request()
            .input('serial', sql.NVarChar, SERIAL)
            .query('SELECT SERIAL FROM Information WHERE SERIAL = @serial');

        if (check.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                message: `Serial ${SERIAL} มีอยู่ในระบบแล้ว`
            });
        }

        await pool.request()
            .input('SERIAL', sql.NVarChar, SERIAL)
            .input('Plant', sql.NVarChar, Plant || '')
            .input('Detail_Model', sql.NVarChar, Detail_Model || '')
            .input('Type', sql.NVarChar, Type || '')
            .input('Cost', sql.NVarChar, Cost || '')
            .input('IO', sql.NVarChar, IO || '')
            .input('GL', sql.NVarChar, GL || '')
            .input('BaseUnit', sql.NVarChar, BaseUnit || '')
            .input('PurchasingOrganization', sql.NVarChar, PurchasingOrganization || '')
            .input('PurchasingGroup', sql.NVarChar, PurchasingGroup || '')
            .input('MaterialGroup', sql.NVarChar, MaterialGroup || '')
            .input('RequirementTracking', sql.NVarChar, RequirementTracking || '')
            .input('Requisitioner', sql.NVarChar, Requisitioner || '')
            .input('CreatedBy', sql.NVarChar, user || 'Unknown')
            .query(`
                INSERT INTO Information
                (SERIAL, Plant, Detail_Model, Type, Cost, IO, GL,
                 BaseUnit, PurchasingOrganization, PurchasingGroup,
                 MaterialGroup, RequirementTracking, Requisitioner,
                 CreatedBy, CreatedDate)
                VALUES
                (@SERIAL, @Plant, @Detail_Model, @Type, @Cost, @IO, @GL,
                 @BaseUnit, @PurchasingOrganization, @PurchasingGroup,
                 @MaterialGroup, @RequirementTracking, @Requisitioner,
                 @CreatedBy, GETDATE())
            `);

        console.log(`✅ Master created: ${SERIAL} by ${user}`);

        res.json({
            success: true,
            message: `เพิ่มข้อมูล Serial: ${SERIAL} สำเร็จ`
        });
    } catch (error) {
        console.error('❌ Master create error:', error.message);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการเพิ่มข้อมูล',
            error: error.message
        });
    }
});

/**
 * แก้ไข Master Data
 * PUT /api/master/update
 */
app.put('/api/master/update', async (req, res) => {
    try {
        const {
            SERIAL, Plant, Detail_Model, Type, Cost, IO, GL,
            BaseUnit, PurchasingOrganization, PurchasingGroup,
            MaterialGroup, RequirementTracking, Requisitioner, user
        } = req.body;

        if (!SERIAL) {
            return res.status(400).json({
                success: false,
                message: 'กรุณาระบุ Serial Number'
            });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('SERIAL', sql.NVarChar, SERIAL)
            .input('Plant', sql.NVarChar, Plant || '')
            .input('Detail_Model', sql.NVarChar, Detail_Model || '')
            .input('Type', sql.NVarChar, Type || '')
            .input('Cost', sql.NVarChar, Cost || '')
            .input('IO', sql.NVarChar, IO || '')
            .input('GL', sql.NVarChar, GL || '')
            .input('BaseUnit', sql.NVarChar, BaseUnit || '')
            .input('PurchasingOrganization', sql.NVarChar, PurchasingOrganization || '')
            .input('PurchasingGroup', sql.NVarChar, PurchasingGroup || '')
            .input('MaterialGroup', sql.NVarChar, MaterialGroup || '')
            .input('RequirementTracking', sql.NVarChar, RequirementTracking || '')
            .input('Requisitioner', sql.NVarChar, Requisitioner || '')
            .input('UpdatedBy', sql.NVarChar, user || 'Unknown')
            .query(`
                UPDATE Information SET
                    Plant = @Plant,
                    Detail_Model = @Detail_Model,
                    Type = @Type,
                    Cost = @Cost,
                    IO = @IO,
                    GL = @GL,
                    BaseUnit = @BaseUnit,
                    PurchasingOrganization = @PurchasingOrganization,
                    PurchasingGroup = @PurchasingGroup,
                    MaterialGroup = @MaterialGroup,
                    RequirementTracking = @RequirementTracking,
                    Requisitioner = @Requisitioner,
                    UpdatedBy = @UpdatedBy,
                    UpdatedDate = GETDATE()
                WHERE SERIAL = @SERIAL
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                message: `ไม่พบ Serial: ${SERIAL}`
            });
        }

        console.log(`✅ Master updated: ${SERIAL} by ${user}`);

        res.json({
            success: true,
            message: `แก้ไขข้อมูล Serial: ${SERIAL} สำเร็จ`
        });
    } catch (error) {
        console.error('❌ Master update error:', error.message);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการแก้ไขข้อมูล',
            error: error.message
        });
    }
});

/**
 * ลบ Master Data
 * DELETE /api/master/delete
 * Body: { "serial": "xxx" }
 */
app.delete('/api/master/delete', async (req, res) => {
    try {
        const { serial } = req.body;

        if (!serial) {
            return res.status(400).json({
                success: false,
                message: 'กรุณาระบุ Serial Number'
            });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('serial', sql.NVarChar, serial)
            .query('DELETE FROM Information WHERE SERIAL = @serial');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                message: `ไม่พบ Serial: ${serial}`
            });
        }

        console.log(`🗑️ Master deleted: ${serial}`);

        res.json({
            success: true,
            message: `ลบข้อมูล Serial: ${serial} สำเร็จ`
        });
    } catch (error) {
        console.error('❌ Master delete error:', error.message);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการลบข้อมูล',
            error: error.message
        });
    }
});

// ==================== Interface History APIs ====================

/**
 * ดึงประวัติ Send Interface
 * GET /api/history?user=xxx&startDate=2024-01-01&endDate=2024-12-31
 */
app.get('/api/history', async (req, res) => {
    try {
        const { user, startDate, endDate } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let query = `
            SELECT ID, ScanFilename, OutputFilename, CreatedDate, CreatedBy
            FROM InterfaceHistory
            WHERE 1=1
        `;

        if (user && user !== 'System') {
            query += ` AND CreatedBy = @user`;
            request.input('user', sql.NVarChar, user);
        }

        if (startDate) {
            query += ` AND CreatedDate >= @startDate`;
            request.input('startDate', sql.DateTime, new Date(startDate));
        }

        if (endDate) {
            query += ` AND CreatedDate <= @endDate`;
            // endDate ให้รวมทั้งวัน โดยเพิ่ม 1 วัน
            const end = new Date(endDate);
            end.setDate(end.getDate() + 1);
            request.input('endDate', sql.DateTime, end);
        }

        query += ` ORDER BY CreatedDate DESC`;

        const result = await request.query(query);

        res.json({
            success: true,
            total: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        console.error('❌ History error:', error.message);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการดึงประวัติ',
            error: error.message
        });
    }
});

// ==================== Start Server ====================

app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════════╗');
    console.log('║   SAP PR Generator - API Server            ║');
    console.log('╠════════════════════════════════════════════╣');
    console.log(`║   🚀 Server running on port ${PORT}            ║`);
    console.log(`║   📡 API: http://localhost:${PORT}/api        ║`);
    console.log('║                                            ║');
    console.log('║   Endpoints:                               ║');
    console.log('║   • GET  /api/health                       ║');
    console.log('║   • GET  /api/test-db                      ║');
    console.log('║   • GET  /api/check-share                  ║');
    console.log('║   • POST /api/search-serial                ║');
    console.log('║   • POST /api/search-serials               ║');
    console.log('║   • POST /api/save-file                    ║');
    console.log('║   • GET  /api/master/list                  ║');
    console.log('║   • GET  /api/master/search                ║');
    console.log('║   • POST /api/master/create                ║');
    console.log('║   • PUT  /api/master/update                ║');
    console.log('║   • DEL  /api/master/delete                ║');
    console.log('║   • GET  /api/history                      ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log(`📁 Interface Path: ${INTERFACE_PATH}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    if (pool) {
        await pool.close();
        console.log('✅ Database connection closed');
    }
    process.exit(0);
});