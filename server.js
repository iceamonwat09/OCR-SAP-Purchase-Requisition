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
 * บันทึกไฟล์ JSON ไปยัง Network Share
 * POST /api/save-file
 * Body: { "filename": "SAP_PR_xxx.json", "content": { ... } }
 */
app.post('/api/save-file', async (req, res) => {
    try {
        const { filename, content } = req.body;
        
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