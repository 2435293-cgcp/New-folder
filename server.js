const http = require('http');
const fs   = require('fs');
const path = require('path');

// Load .env without any dependencies
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (key) process.env[key] = val;
    });
}

loadEnv();

const PORT     = process.env.PORT || 3000;
const API_KEY  = process.env.GEMINI_API_KEY || '';
const ORG_NAME = process.env.ORG_NAME || 'MediCare Organization';
const HTML_FILE = path.join(__dirname, 'medicare_agent.html');

// Build the injected <script> block that pre-fills the settings panel
const envScript = `<script id="env-config">window.__ENV__ = ${JSON.stringify({
  GEMINI_API_KEY: API_KEY,
  ORG_NAME:       ORG_NAME
})};<\/script>`;

const server = http.createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/index.html') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let html;
  try {
    html = fs.readFileSync(HTML_FILE, 'utf8');
  } catch {
    res.writeHead(500);
    res.end('Could not read medicare_agent.html');
    return;
  }

  // Replace the placeholder <script> tag with real env values
  html = html.replace(
    /<!-- Populated by server\.js[^>]*-->\s*<script id="env-config">.*?<\/script>/s,
    envScript
  );

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, () => {
  console.log(`MediCare AI Agent running at http://localhost:${PORT}`);
  console.log(`Org: ${ORG_NAME}`);
  console.log(`API key: ${API_KEY ? '✓ loaded from .env' : '✗ not set — enter it in Settings'}`);
});
