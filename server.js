'use strict';
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const Fuse     = require('fuse.js');
const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path     = require('path');
const fs       = require('fs');

const aiService      = require('./services/ai_service');
const offlineService = require('./services/offline_service');
const sessionCache   = require('./utils/cache');

const app  = express();
const PORT = process.env.PORT || 3000;

const AI_NAME  = process.env.AI_NAME          || 'Ash';
const ORG_NAME = process.env.ORG_NAME         || 'Ash AI Healthcare';
const API_KEY  = process.env.GEMINI_API_KEY   || '';

// lowdb
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const adapter = new FileSync(path.join(DATA_DIR, 'knowledge.json'));
const db      = low(adapter);
db.defaults({ entries: [] }).write();

function buildFuse(entries) {
  return new Fuse(entries, {
    keys: [
      { name: 'question', weight: 0.5 },
      { name: 'keywords', weight: 0.3 },
      { name: 'answer',   weight: 0.1 },
      { name: 'category', weight: 0.1 },
    ],
    threshold: 0.45, includeScore: true, ignoreLocation: true, minMatchCharLength: 2,
  });
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/status', (req, res) => {
  const medKb = (() => { try { return require('./data/medical_kb.json'); } catch { return { categories: {} }; } })();
  res.json({
    aiName: AI_NAME, org: ORG_NAME, hasApiKey: !!API_KEY,
    mode: API_KEY ? 'online' : 'offline',
    kbEntries: db.get('entries').value().length,
    medKbCategories: Object.keys(medKb.categories || {}).length,
    cacheStats: sessionCache.getStats(),
  });
});

app.post('/api/chat', async (req, res) => {
  const { message = '', history = [], systemPrompt = '', sessionId = 'default' } = req.body;

  const latestText = message
    || history.filter(h => h.role === 'user').at(-1)?.parts?.[0]?.text
    || history.filter(h => h.role === 'user').at(-1)?.text || '';

  if (!latestText.trim()) {
    return res.json({ reply: "I'm here to help. What health question can I assist you with today? 💙", source: 'local', confidence: 0, emergency: null });
  }

  sessionCache.appendToSession(sessionId, 'user', latestText);

  if (API_KEY) {
    try {
      const aiHistory = history.map(h => ({ role: h.role === 'model' ? 'assistant' : h.role, text: h.parts?.[0]?.text || h.text || '' }));
      const reply = await aiService.callGemini(API_KEY, systemPrompt || aiService.buildSystemPrompt(), aiHistory);
      sessionCache.appendToSession(sessionId, 'assistant', reply);
      return res.json({ reply, source: 'gemini', confidence: 100, emergency: null });
    } catch (err) {
      console.warn(`[chat] Gemini unavailable (${err.message}) — switching to offline mode`);
    }
  }

  const offlineResult = offlineService.buildResponse(latestText);
  if (offlineResult.extractedSymptoms && offlineResult.extractedSymptoms.length > 0) {
    sessionCache.updateSymptoms(sessionId, offlineResult.extractedSymptoms);
  }

  const entries = db.get('entries').value();
  if (entries.length && (!offlineResult.reply || offlineResult.confidence < 30)) {
    const hits = buildFuse(entries).search(latestText);
    if (hits.length) {
      const best = hits[0].item;
      const score = Math.round((1 - (hits[0].score || 0)) * 100);
      sessionCache.appendToSession(sessionId, 'assistant', best.answer);
      return res.json({ reply: best.answer, source: 'local', confidence: score, emergency: null, matched: best.question });
    }
  }

  sessionCache.appendToSession(sessionId, 'assistant', offlineResult.reply);
  res.json({
    reply: offlineResult.reply, source: 'local', confidence: offlineResult.confidence,
    emergency: offlineResult.emergency, matches: (offlineResult.matches || []).map(m => m.categoryId),
  });
});

app.get('/api/knowledge', (req, res) => res.json(db.get('entries').value()));

app.post('/api/train', (req, res) => {
  const { question, answer, keywords = [], category = 'custom' } = req.body;
  if (!question?.trim() || !answer?.trim()) return res.status(400).json({ error: 'question and answer are required' });
  const entry = {
    id: Date.now(), question: question.trim(),
    keywords: Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim()).filter(Boolean),
    answer: answer.trim(), category, createdAt: new Date().toISOString(),
  };
  db.get('entries').push(entry).write();
  res.json({ success: true, entry, total: db.get('entries').value().length });
});

app.delete('/api/train/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const removed = db.get('entries').remove({ id }).write();
  if (!removed.length) return res.status(404).json({ error: 'Entry not found' });
  res.json({ success: true });
});

app.get('/api/medicines', (req, res) => {
  try {
    const medicines = require('./data/medicines.json');
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q) return res.json(medicines.slice(0, 20));
    res.json(medicines.filter(m => m.name.toLowerCase().includes(q) || (m.generic_name||'').toLowerCase().includes(q) || (m.uses||[]).some(u => u.toLowerCase().includes(q))).slice(0, 10));
  } catch { res.json([]); }
});

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const entries = db.get('entries').value();
  if (!entries.length) return res.json([]);
  res.json(buildFuse(entries).search(q).slice(0, 6).map(r => ({ score: Math.round((1-(r.score||0))*100), question: r.item.question, answer: r.item.answer, category: r.item.category })));
});

app.get('/api/test-offline', (req, res) => {
  const q = req.query.q || 'I have a headache';
  const result = offlineService.buildResponse(q);
  res.json({ query: q, source: result.source, confidence: result.confidence, emergency: result.emergency?.name || null, matchedCategories: (result.matches||[]).map(m => m.categoryId) });
});

app.listen(PORT, () => {
  const medKbCats = (() => { try { return Object.keys(require('./data/medical_kb.json').categories).length; } catch { return 0; } })();
  console.log(`\n  ╔══════════════════════════════════════════════════╗`);
  console.log(`  ║   🌿 ASH AI HEALTHCARE ASSISTANT                ║`);
  console.log(`  ║   Smart Healthcare Guidance, Online or Offline.  ║`);
  console.log(`  ╚══════════════════════════════════════════════════╝`);
  console.log(`  URL        : http://localhost:${PORT}`);
  console.log(`  Mode       : ${API_KEY ? '🟢 Online (Gemini AI)' : '🟡 Offline (Local KB)'}`);
  console.log(`  Medical KB : ${medKbCats} categories`);
  console.log(`  Custom KB  : ${db.get('entries').value().length} entries\n`);
});
