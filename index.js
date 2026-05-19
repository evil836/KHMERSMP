// index.js - Express Server (No Security, Clean URLs)
// Removed: rate limiting, helmet security, bot protection, DDoS protection

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 55096;

// ========== MINECRAFT SERVER API CONFIGURATION ==========
const MINECRAFT_SERVER_HOST = "15.235.181.233";
const MINECRAFT_SERVER_PORT = "62067";
const apiUrl = `https://api.mcstatus.io/v2/status/java/${MINECRAFT_SERVER_HOST}:${MINECRAFT_SERVER_PORT}`;

// ========== GLOBAL VARIABLES ==========
let currentVersion = Date.now();
let cachedServerStatus = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5000;

// ========== REMOVE TRAILING SLASH MIDDLEWARE ==========
// ប្តូរ /ranks/ → /ranks, /admin/ → /admin, /vote/ → /vote
app.use((req, res, next) => {
    // បើ URL មិនមែន '/' ហើយមាន trailing slash
    if (req.path !== '/' && req.path.endsWith('/')) {
        // កាត់ slash ខាងចុងចេញ
        const newUrl = req.originalUrl.replace(/\/$/, '');
        // 301 Permanent Redirect
        return res.redirect(301, newUrl);
    }
    next();
});

// ========== FUNCTION TO FETCH SERVER STATUS ==========
async function fetchServerStatus() {
    const now = Date.now();
    
    if (cachedServerStatus && (now - lastFetchTime) < CACHE_DURATION) {
        return cachedServerStatus;
    }
    
    try {
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        cachedServerStatus = data;
        lastFetchTime = now;
        
        return data;
    } catch (error) {
        if (cachedServerStatus) {
            return { ...cachedServerStatus, _cached: true, _error: error.message };
        }
        
        return {
            online: true,
            error: error.message,
            players: { online: 0, max: 0, list: [] },
            host: MINECRAFT_SERVER_HOST,
            port: MINECRAFT_SERVER_PORT
        };
    }
}

// ========== AUTO REFRESH MIDDLEWARE ==========
app.use('/', (req, res, next) => {
    const originalSend = res.send;
    res.send = function(data) {
        if (res.getHeader('Content-Type')?.includes('text/html') && typeof data === 'string') {
            const autoRefreshScript = `
                <script>
                (function() {
                    let lastVersion = ${currentVersion};
                    setInterval(async () => {
                        try {
                            const response = await fetch('/api/version', {
                                cache: 'no-store',
                                headers: { 'Cache-Control': 'no-cache' }
                            });
                            const newVersion = await response.text();
                            if (parseInt(newVersion) !== lastVersion) {
                                lastVersion = parseInt(newVersion);
                                location.reload();
                            }
                        } catch(e) {}
                    }, 3000);
                })();
                </script>
            `;
            data = data.replace('</body>', autoRefreshScript + '</body>');
        }
        originalSend.call(this, data);
    };
    next();
});

// ========== API ENDPOINTS ==========

app.get('/api/version', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/plain');
    res.send(currentVersion.toString());
});

let lastChangedFile = null;
app.get('/api/changed', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'application/json');
    res.json({
        changed: lastChangedFile !== null,
        file: lastChangedFile,
        message: lastChangedFile ? `📁 ${lastChangedFile} has been updated` : null
    });
});

// ========== MINECRAFT SERVER API PROXY ==========

app.get('/api/minecraft/status', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    try {
        const status = await fetchServerStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ 
            online: false, 
            error: error.message,
            players: { online: 0, max: 0, list: [] }
        });
    }
});

app.get('/api/minecraft/proxy', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    try {
        const status = await fetchServerStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/minecraft/players', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'application/json');
    
    try {
        const status = await fetchServerStatus();
        res.json({
            online: status.online,
            count: status.players?.online || 0,
            max: status.players?.max || 0,
            list: status.players?.list || []
        });
    } catch (error) {
        res.status(500).json({ online: false, count: 0, max: 0, list: [] });
    }
});

app.get('/api/minecraft/info', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'application/json');
    
    try {
        const status = await fetchServerStatus();
        res.json({
            online: status.online,
            host: status.host,
            port: status.port,
            version: status.version,
            motd: status.motd,
            ip_address: status.ip_address
        });
    } catch (error) {
        res.status(500).json({ online: false, error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: Date.now(),
        protocol: req.protocol,
        hostname: req.hostname,
        uptime: process.uptime()
    });
});

// ========== WATCH FILES ==========
function watchFiles(directory) {
    try {
        fs.watch(directory, { recursive: true }, (eventType, filename) => {
            if (filename && !filename.includes('node_modules') && !filename.includes('.git')) {
                currentVersion = Date.now();
                lastChangedFile = filename;
                setTimeout(() => { lastChangedFile = null; }, 3000);
            }
        });
    } catch (err) {
        // Silent - no logs
    }
}

watchFiles(path.join(__dirname, '.'));

// ========== STATIC FILES ==========
app.use(express.static(__dirname, { index: false }));

// ========== ROUTES ==========

// Home page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Helper function to serve HTML files
function servePage(pageName) {
    return (req, res) => {
        const filePath = path.join(__dirname, `${pageName}.html`);
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).sendFile(path.join(__dirname, '404.html'));
        }
    };
}

// Clean URL routes (without .html) - NO TRAILING SLASH
app.get('/ranks', servePage('ranks'));
app.get('/vote', servePage('vote'));
app.get('/help', servePage('help'));
app.get('/admin', servePage('admin'));
app.get('/online', servePage('online'));
app.get('/viewranks', servePage('viewranks'));

// Also support .html URLs for backward compatibility
app.get('/ranks.html', servePage('ranks'));
app.get('/vote.html', servePage('vote'));
app.get('/help.html', servePage('help'));
app.get('/admin.html', servePage('admin'));
app.get('/online.html', servePage('online'));
app.get('/viewranks.html', servePage('viewranks'));

// ========== ERROR HANDLERS ==========

// 404 Handler
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.status(404).sendFile(path.join(__dirname, '404.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Server error:', err.message);
    if (req.path.startsWith('/api/')) {
        return res.status(500).json({ error: 'Internal server error' });
    }
    res.status(500).sendFile(path.join(__dirname, '500.html'));
});

// ========== START SERVER ==========
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 Access at: http://localhost:${PORT}`);
    console.log(`📋 Clean URLs (no trailing slash):`);
    console.log(`   - /ranks     (NOT /ranks/)`);
    console.log(`   - /vote      (NOT /vote/)`);
    console.log(`   - /help      (NOT /help/)`);
    console.log(`   - /admin     (NOT /admin/)`);
    console.log(`   - /online    (NOT /online/)`);
    console.log(`   - /viewranks (NOT /viewranks/)`);
    console.log(`\n💡 If you see /ranks/, it will redirect to /ranks`);
    console.log(`🔓 Security features: ALL REMOVED (no rate limit, no helmet)`);
});

process.on('SIGINT', () => {
    console.log('Shutting down...');
    process.exit(0);
});
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    process.exit(0);
});