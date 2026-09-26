// Zero-dependency static file server for running the e2e suite against the
// actual repo folder (index.html + js/*.js), exactly as Netlify Drop serves it.
// No build step in this app, so this is deliberately not a bundler/dev-server —
// just enough to let `fetch`/`<script src>` resolve relative paths.
//
// Usage: node tests/e2e/static-server.js [port]
// Playwright's webServer config in playwright.config.js runs this automatically.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..'); // repo root (Desktop/jewelos)
const PORT = Number(process.argv[2] || process.env.E2E_STATIC_PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer(function (req, res) {
  var reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';

  var filePath = path.join(ROOT, reqPath);

  // Never serve outside the repo root.
  if (filePath.indexOf(ROOT) !== 0) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + reqPath);
      return;
    }
    var ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, function () {
  console.log('[e2e static-server] serving ' + ROOT + ' at http://localhost:' + PORT);
});
