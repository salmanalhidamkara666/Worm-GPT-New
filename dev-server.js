import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import handler from './api/chat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let port = 3006;

// Function untuk mencari port yang tersedia
function findAvailablePort(startPort = 3006, maxAttempts = 10) {
  return new Promise((resolve, reject) => {
    let currentPort = startPort;
    let attempts = 0;
    
    const tryPort = () => {
      if (attempts >= maxAttempts) {
        reject(new Error('No available port found'));
        return;
      }
      
      const server = http.createServer();
      server.once('error', err => {
        if (err.code === 'EADDRINUSE') {
          attempts++;
          currentPort++;
          tryPort();
        } else {
          reject(err);
        }
      });
      
      server.listen(currentPort, '127.0.0.1', () => {
        server.close();
        resolve(currentPort);
      });
    };
    
    tryPort();
  });
}

// Load .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').replace(/^"|"$/g, '');
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = value;
        }
      }
    });
  }
}

loadEnv();

// Create server
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        req.body = parsed;
        
        // Wrap response untuk kompatibilitas dengan handler Vercel
        const wrappedRes = {
          statusCode: 200,
          _headers: {},
          status: function(code) {
            this.statusCode = code;
            return this;
          },
          setHeader: function(key, val) {
            this._headers[key] = val;
            return this;
          },
          writeHead: function(code, headers = {}) {
            this.statusCode = code;
            res.writeHead(code, { ...this._headers, ...headers });
            return this;
          },
          write: function(data) {
            res.write(data);
            return true;
          },
          json: function(data) {
            res.writeHead(this.statusCode, { 'Content-Type': 'application/json', ...this._headers });
            res.end(JSON.stringify(data));
            return this;
          },
          end: function(data) {
            if (data) res.end(data);
            else res.end();
            return this;
          }
        };
        
        await handler(req, wrappedRes);
      } catch (err) {
        console.error('Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error', details: err.message }));
      }
    });
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      }
    });
    return;
  }

  // Serve static files (CSS, JS, etc)
  const filePath = path.join(__dirname, req.url);
  if (filePath.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const mimeTypes = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Internal server error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

// Cari port yang tersedia dan jalankan server
findAvailablePort(3006).then(availablePort => {
  port = availablePort;
  server.listen(port, '127.0.0.1', () => {
    console.log(`✓ Server berjalan di http://127.0.0.1:${port}`);
    console.log(`✓ API endpoint: http://127.0.0.1:${port}/api/chat`);
  });
}).catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
