const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Load .env ──────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
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
const AI_NAME   = process.env.AI_NAME    || 'MediCare AI';
const POWERED_BY = process.env.POWERED_BY || 'Gemini';
const HTML_FILE = path.join(__dirname, 'medicare_agent.html');
const KB_FILE   = path.join(__dirname, 'knowledge.json');

// ── Knowledge Base helpers ─────────────────────────────────────────
function loadKB() {
  try { return JSON.parse(fs.readFileSync(KB_FILE, 'utf8')); }
  catch { return []; }
}

function saveKB(kb) {
  fs.writeFileSync(KB_FILE, JSON.stringify(kb, null, 2), 'utf8');
}

const STOPWORDS = new Set([
  'the','is','are','was','were','what','how','when','where','why','who',
  'which','this','that','these','those','can','could','would','should',
  'have','has','had','for','and','but','not','with','from','about','any',
  'its','also','just','use','used','does','does','get','my','me','do','i',
  'to','a','an','of','in','it','if','on','at','be','by','as','or','so'
]);

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// Jaccard + keyword-boost scoring
function findBestAnswer(query) {
  const kb = loadKB();
  if (!kb.length) return null;

  const qWords = new Set(tokenize(query));
  let bestScore = 0;
  let bestEntry = null;

  for (const entry of kb) {
    const haystack = [
      entry.question,
      ...(entry.keywords || []),
      entry.category || ''
    ].join(' ');
    const hWords = new Set(tokenize(haystack));

    // Jaccard similarity
    const inter = [...qWords].filter(w => hWords.has(w)).length;
    const union = new Set([...qWords, ...hWords]).size;
    let score = inter / union;

    // Bonus: direct keyword hit
    const kwHits = (entry.keywords || []).filter(k =>
      query.toLowerCase().includes(k.toLowerCase())
    ).length;
    score += kwHits * 0.12;

    if (score > bestScore) { bestScore = score; bestEntry = entry; }
  }

  return bestScore >= 0.12 ? bestEntry : null;
}

// ── Gemini API (server-side) ───────────────────────────────────────
function callGemini(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 15000
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) { reject(parsed.error); return; }
          const text = parsed.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Gemini timeout')); });
    req.write(payload);
    req.end();
  });
}

// ── JSON body reader ───────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

// ── HTML injection ─────────────────────────────────────────────────
const envScript = `<script id="env-config">window.__ENV__ = ${JSON.stringify({
  GEMINI_API_KEY: API_KEY,
  ORG_NAME,
  AI_NAME,
  POWERED_BY
})};<\/script>`;

function serveHtml(res) {
  let html;
  try { html = fs.readFileSync(HTML_FILE, 'utf8'); }
  catch { res.writeHead(500); res.end('Could not read medicare_agent.html'); return; }

  html = html.replace(
    /<!-- Populated by server\.js[^>]*-->\s*<script id="env-config">.*?<\/script>/s,
    envScript
  );
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ── HTTP Server ────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { method } = req;
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  // ── GET / ── serve app
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return serveHtml(res);
  }

  // ── POST /api/chat ── hybrid: Gemini → local KB fallback
  if (method === 'POST' && pathname === '/api/chat') {
    let body;
    try { body = await readBody(req); }
    catch { return json(res, 400, { error: 'Invalid JSON' }); }

    const { history = [], systemPrompt = '' } = body;

    if (API_KEY) {
      try {
        const reply = await callGemini({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: history,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
        });
        return json(res, 200, { reply, source: 'gemini' });
      } catch (err) {
        console.warn('Gemini unavailable, falling back to local KB:', err.message || err);
      }
    }

    // Offline fallback
    const lastMsg = history.at(-1)?.parts?.[0]?.text || '';
    const found   = findBestAnswer(lastMsg);

    if (found) {
      return json(res, 200, {
        reply: found.answer,
        source: 'local',
        matched: found.question
      });
    }

    return json(res, 200, {
      reply: "I'm currently in **offline mode** and couldn't find a matching answer in my knowledge base.\n\nFor complex or urgent medical questions, please:\n- Check your internet connection for full AI capabilities\n- Consult a healthcare professional directly\n\nPlease consult your doctor or pharmacist before starting, stopping, or changing any medication.",
      source: 'local'
    });
  }

  // ── POST /api/train ── add a new Q&A entry
  if (method === 'POST' && pathname === '/api/train') {
    let body;
    try { body = await readBody(req); }
    catch { return json(res, 400, { error: 'Invalid JSON' }); }

    const { question, answer, keywords = [], category = 'custom' } = body;
    if (!question?.trim() || !answer?.trim())
      return json(res, 400, { error: 'question and answer are required' });

    const kb = loadKB();
    const entry = {
      id: Date.now(),
      question: question.trim(),
      keywords: Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim()).filter(Boolean),
      answer: answer.trim(),
      category
    };
    kb.push(entry);
    saveKB(kb);
    console.log(`[train] added: "${entry.question}"`);
    return json(res, 200, { success: true, entry, total: kb.length });
  }

  // ── DELETE /api/train/:id ── remove a knowledge entry
  if (method === 'DELETE' && pathname.startsWith('/api/train/')) {
    const id = parseInt(pathname.split('/').pop(), 10);
    const kb = loadKB();
    const idx = kb.findIndex(e => e.id === id);
    if (idx === -1) return json(res, 404, { error: 'Entry not found' });
    const [removed] = kb.splice(idx, 1);
    saveKB(kb);
    return json(res, 200, { success: true, removed });
  }

  // ── GET /api/knowledge ── return full knowledge base
  if (method === 'GET' && pathname === '/api/knowledge') {
    return json(res, 200, loadKB());
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\nMediCare AI Agent → http://localhost:${PORT}`);
  console.log(`Organization : ${ORG_NAME}`);
  console.log(`Gemini API   : ${API_KEY ? '✓ loaded' : '✗ not set — offline mode only'}`);
  console.log(`Knowledge base: ${loadKB().length} entries\n`);
});
