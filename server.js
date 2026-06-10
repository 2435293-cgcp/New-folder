'use strict';

/**
 * server.js — Ash AI Healthcare Assistant
 *
 * Request pipeline for /api/chat:
 *   1. Emergency detection (always first — pattern + combination alerts)
 *   2. Gemini AI (if GEMINI_API_KEY is set and quota is available)
 *   3. Offline service  (custom symptom_matcher + Fuse.js fallback)
 *   4. Custom KB Fuse  (user-trained entries in data/knowledge.json)
 *
 * The server stays fully functional with no API key using the local KB alone.
 */

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
const fuseSearch     = require('./services/fuse_search');   // Fuse.js medical KB search
const sessionCache   = require('./utils/cache');

const app  = express();
const PORT = process.env.PORT || 3000;

const AI_NAME  = process.env.AI_NAME        || 'Ash';
const ORG_NAME = process.env.ORG_NAME       || 'Ash AI Healthcare';
const API_KEY  = process.env.GEMINI_API_KEY || '';

// ---------------------------------------------------------------------------
// lowdb — stores user-trained custom knowledge entries
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const adapter = new FileSync(path.join(DATA_DIR, 'knowledge.json'));
const db      = low(adapter);
db.defaults({ entries: [] }).write();

// Fuse instance over user-trained entries (rebuilt each query for freshness)
function buildCustomFuse(entries) {
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

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------------------------------------------------------------------------
// GET /api/status — health-check + mode information
// ---------------------------------------------------------------------------
app.get('/api/status', (req, res) => {
  const medKb = (() => {
    try { return require('./data/medical_kb.json'); } catch { return { categories: {} }; }
  })();

  res.json({
    aiName:          AI_NAME,
    org:             ORG_NAME,
    hasApiKey:       !!API_KEY,
    mode:            API_KEY ? 'online' : 'offline',
    kbEntries:       db.get('entries').value().length,
    medKbCategories: Object.keys(medKb.categories || {}).length,
    cacheStats:      sessionCache.getStats(),
  });
});

// ---------------------------------------------------------------------------
// POST /api/chat — main chat endpoint
// ---------------------------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  const { message = '', history = [], systemPrompt = '', sessionId = 'default' } = req.body;

  // Resolve the latest user message from either field or history
  const latestText = message
    || history.filter(h => h.role === 'user').at(-1)?.parts?.[0]?.text
    || history.filter(h => h.role === 'user').at(-1)?.text
    || '';

  if (!latestText.trim()) {
    return res.json({
      reply: "Hello! I'm Ash, your healthcare assistant. I can help with symptoms, medicines, first aid, and general health information. How can I help you today? 💙",
      source: 'local', confidence: 0, emergency: null,
    });
  }

  sessionCache.appendToSession(sessionId, 'user', latestText);

  // Step 1 — Try Gemini AI (online mode)
  if (API_KEY) {
    try {
      const aiHistory = history.map(h => ({
        role: h.role === 'model' ? 'assistant' : h.role,
        text: h.parts?.[0]?.text || h.text || '',
      }));
      const reply = await aiService.callGemini(API_KEY, systemPrompt || aiService.buildSystemPrompt(), aiHistory);
      sessionCache.appendToSession(sessionId, 'assistant', reply);
      return res.json({ reply, source: 'gemini', confidence: 100, emergency: null });
    } catch (err) {
      console.warn(`[chat] Gemini unavailable (${err.message}) — switching to offline KB`);
    }
  }

  // Step 2 — Offline knowledge base (custom symptom_matcher + Fuse.js fallback)
  const offlineResult = offlineService.buildResponse(latestText);
  if (offlineResult.extractedSymptoms && offlineResult.extractedSymptoms.length > 0) {
    sessionCache.updateSymptoms(sessionId, offlineResult.extractedSymptoms);
  }

  // Step 3 — User-trained custom KB via Fuse.js (supplement if offline confidence is low)
  const entries = db.get('entries').value();
  if (entries.length && offlineResult.confidence < 30) {
    const hits = buildCustomFuse(entries).search(latestText);
    if (hits.length) {
      const best  = hits[0].item;
      const score = Math.round((1 - (hits[0].score || 0)) * 100);
      sessionCache.appendToSession(sessionId, 'assistant', best.answer);
      return res.json({
        reply:   best.answer,
        source:  'local',
        confidence: score,
        emergency:  null,
        matched: best.question,
      });
    }
  }

  sessionCache.appendToSession(sessionId, 'assistant', offlineResult.reply);
  res.json({
    reply:      offlineResult.reply,
    source:     'local',
    confidence: offlineResult.confidence,
    emergency:  offlineResult.emergency,
    matches:    (offlineResult.matches || []).map(m => m.categoryId),
  });
});

// ---------------------------------------------------------------------------
// GET /api/knowledge — list all user-trained entries
// ---------------------------------------------------------------------------
app.get('/api/knowledge', (req, res) => res.json(db.get('entries').value()));

// ---------------------------------------------------------------------------
// POST /api/train — add a custom knowledge entry
// ---------------------------------------------------------------------------
app.post('/api/train', (req, res) => {
  const { question, answer, keywords = [], category = 'custom' } = req.body;
  if (!question?.trim() || !answer?.trim()) {
    return res.status(400).json({ error: 'question and answer are required' });
  }
  const entry = {
    id:        Date.now(),
    question:  question.trim(),
    keywords:  Array.isArray(keywords)
      ? keywords
      : keywords.split(',').map(k => k.trim()).filter(Boolean),
    answer:    answer.trim(),
    category,
    createdAt: new Date().toISOString(),
  };
  db.get('entries').push(entry).write();
  res.json({ success: true, entry, total: db.get('entries').value().length });
});

// ---------------------------------------------------------------------------
// DELETE /api/train/:id — remove a custom entry
// ---------------------------------------------------------------------------
app.delete('/api/train/:id', (req, res) => {
  const id      = parseInt(req.params.id, 10);
  const removed = db.get('entries').remove({ id }).write();
  if (!removed.length) return res.status(404).json({ error: 'Entry not found' });
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// GET /api/medicines?q=<query> — Fuse.js powered medicine search
// ---------------------------------------------------------------------------
app.get('/api/medicines', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    // Return first 20 medicines when no query is provided
    try {
      const all = require('./data/medicines.json');
      return res.json(all.slice(0, 20));
    } catch {
      return res.json([]);
    }
  }
  // Use Fuse.js for fuzzy medicine search
  res.json(fuseSearch.searchMedicines(q, 10));
});

// ---------------------------------------------------------------------------
// GET /api/search?q=<query> — searches medical KB categories + custom entries
// ---------------------------------------------------------------------------
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  // Search built-in medical KB categories
  const categoryHits = fuseSearch.searchCategories(q, 4).map(r => ({
    score:    r.score,
    question: r.category.name,
    answer:   r.category.description,
    category: r.category.id,
    source:   'medical_kb',
  }));

  // Search user-trained custom entries
  const customEntries = db.get('entries').value();
  const customHits = customEntries.length
    ? buildCustomFuse(customEntries).search(q).slice(0, 4).map(r => ({
        score:    Math.round((1 - (r.score || 0)) * 100),
        question: r.item.question,
        answer:   r.item.answer,
        category: r.item.category,
        source:   'custom_kb',
      }))
    : [];

  // Merge and sort by score descending
  const combined = [...categoryHits, ...customHits].sort((a, b) => b.score - a.score).slice(0, 8);
  res.json(combined);
});

// ---------------------------------------------------------------------------
// GET /api/test-offline?q=<query> — dev helper to test offline matching
// ---------------------------------------------------------------------------
app.get('/api/test-offline', (req, res) => {
  const q      = req.query.q || 'I have a headache';
  const result = offlineService.buildResponse(q);
  res.json({
    query:            q,
    source:           result.source,
    confidence:       result.confidence,
    emergency:        result.emergency?.name || null,
    matchedCategories:(result.matches || []).map(m => m.categoryId),
    fuseCategories:   fuseSearch.searchCategories(q, 2).map(r => ({ id: r.id, score: r.score })),
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  const medKbCats = (() => {
    try { return Object.keys(require('./data/medical_kb.json').categories).length; } catch { return 0; }
  })();
  console.log(`\n  ╔══════════════════════════════════════════════════╗`);
  console.log(`  ║   🌿 ASH AI HEALTHCARE ASSISTANT v2.1            ║`);
  console.log(`  ║   Smart Healthcare Guidance, Online or Offline.  ║`);
  console.log(`  ╚══════════════════════════════════════════════════╝`);
  console.log(`  URL        : http://localhost:${PORT}`);
  console.log(`  Mode       : ${API_KEY ? '🟢 Online (Gemini AI + Offline Fallback)' : '🟡 Offline (Local Medical KB)'}`);
  console.log(`  Medical KB : ${medKbCats} categories`);
  console.log(`  Custom KB  : ${db.get('entries').value().length} entries\n`);
});
