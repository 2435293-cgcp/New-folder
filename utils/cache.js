'use strict';
const NodeCache = require('node-cache');

const cache = new NodeCache({
  stdTTL: 1800,       // 30-minute session TTL
  checkperiod: 120,
  useClones: false,
});

function getSession(sessionId) {
  return cache.get(sessionId) || { history: [], symptoms: [], lastUpdate: null };
}

function setSession(sessionId, data) {
  cache.set(sessionId, { ...data, lastUpdate: Date.now() });
}

function appendToSession(sessionId, role, text) {
  const session = getSession(sessionId);
  session.history.push({ role, text, timestamp: Date.now() });
  if (session.history.length > 20) {
    session.history = session.history.slice(-20);
  }
  cache.set(sessionId, session);
  return session;
}

function updateSymptoms(sessionId, symptoms) {
  const session = getSession(sessionId);
  const merged = new Set([...(session.symptoms || []), ...symptoms]);
  session.symptoms = Array.from(merged).slice(-15);
  cache.set(sessionId, session);
}

function clearSession(sessionId) {
  cache.del(sessionId);
}

function getStats() {
  const stats = cache.getStats();
  return { keys: cache.keys().length, hits: stats.hits, misses: stats.misses };
}

module.exports = { getSession, setSession, appendToSession, updateSymptoms, clearSession, getStats };
