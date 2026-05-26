const http = require('http');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function send(res, statusCode, body, contentType) {
    res.writeHead(statusCode, {
        'Content-Type': contentType,
        'Cache-Control': contentType.startsWith('text/html') ? 'no-store' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
    });
    res.end(body);
}

function renderAppShell() {
    const template = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    const renderedAt = new Date().toISOString();
    const ssrMarker = `<meta name="rendered-at" content="${renderedAt}">`;
    const noscript = '<noscript><p class="text-center-message">Enable JavaScript to browse live media content.</p></noscript>';

    return template
        .replace('</head>', `    ${ssrMarker}\n</head>`)
        .replace('<main class="content-display">', `<main class="content-display" data-ssr-rendered-at="${renderedAt}">\n                ${noscript}`);
}

function serveStatic(req, res) {
    const requestedPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    const relativePath = requestedPath === '/' ? '/index.html' : requestedPath;
    const filePath = path.resolve(rootDir, `.${relativePath}`);

    if (!filePath.startsWith(`${rootDir}${path.sep}`) && filePath !== path.join(rootDir, 'index.html')) {
        send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
        return;
    }

    if (relativePath === '/index.html') {
        send(res, 200, renderAppShell(), mimeTypes['.html']);
        return;
    }

    // API: POST /mpesa/pay -> bridge to mpesa-integration module
    if (requestedPath === '/mpesa/pay' && req.method === 'POST') {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', async () => {
            try {
                const payload = raw ? JSON.parse(raw) : {};
                // Load mpesa integration module
                const mpesa = require(path.join(rootDir, 'mpesa-integration'));
                // Read consumer credentials from environment variables (keep them secure)
                const consumerKey = process.env.MPESA_CONSUMER_KEY;
                const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
                if (!consumerKey || !consumerSecret) {
                    send(res, 500, JSON.stringify({ success: false, error: 'Missing MPESA credentials on server' }), 'application/json; charset=utf-8');
                    return;
                }

                // Validate expected fields
                const { category, method, projectName, phone, amount } = payload || {};
                if (!category || !method || !phone || !amount) {
                    send(res, 400, JSON.stringify({ success: false, error: 'Missing required fields: category, method, phone, amount' }), 'application/json; charset=utf-8');
                    return;
                }

                // Call processPayment with server-side credentials
                const result = await mpesa.processPayment({ category, method, projectName, phone, amount, consumerKey, consumerSecret });
                send(res, 200, JSON.stringify({ success: true, data: result }), 'application/json; charset=utf-8');
            } catch (err) {
                console.error('MPESA /mpesa/pay error:', err);
                const message = err && err.body ? err.body : (err && err.message) || String(err);
                send(res, 500, JSON.stringify({ success: false, error: message }), 'application/json; charset=utf-8');
            }
        });
        return;
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            send(res, 404, 'Not found', 'text/plain; charset=utf-8');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        send(res, 200, data, mimeTypes[ext] || 'application/octet-stream');
    });
}

http.createServer(serveStatic).listen(port, () => {
    console.log(`SSR server running at http://localhost:${port}`);
});
