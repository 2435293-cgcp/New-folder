'use strict';

/**
 * fuse_search.js — Fuse.js powered search over the medical knowledge base.
 *
 * Provides two independent fuzzy search indexes:
 *   1. categoryFuse  — searches KB categories by trigger_keywords, symptoms, description
 *   2. medicineFuse  — searches medicines.json by name and generic name
 *
 * Key behaviour for medicine search:
 *   extractMedicineName() strips common question phrasing ("tell me about X",
 *   "what is X", "dosage for X") so the Fuse index searches on the clean name
 *   rather than the entire sentence, preventing false positives.
 *
 * Used by offline_service.js (fallback matching) and by the /api/search +
 * /api/medicines endpoints in server.js.
 */

const Fuse = require('fuse.js');

// ---------------------------------------------------------------------------
// Load knowledge bases (cached after first require)
// ---------------------------------------------------------------------------
const medicalKb = require('../data/medical_kb.json');
const medicines = (() => {
  try { return require('../data/medicines.json'); } catch { return []; }
})();

// ---------------------------------------------------------------------------
// Build a flat, searchable list from the KB category objects.
// ---------------------------------------------------------------------------
const KB_CATEGORY_LIST = Object.values(medicalKb.categories || {}).map(cat => ({
  ...cat,
  _keywordsFlat: (cat.trigger_keywords || []).join(' '),
  _symptomsFlat: (cat.symptoms || []).join(' '),
  _causesFlat:   (cat.common_causes || []).join(' '),
}));

// ---------------------------------------------------------------------------
// Category Fuse index
// Weights: trigger_keywords > name > symptoms > description > causes
// ---------------------------------------------------------------------------
const categoryFuse = new Fuse(KB_CATEGORY_LIST, {
  keys: [
    { name: '_keywordsFlat', weight: 0.38 },
    { name: 'name',          weight: 0.25 },
    { name: '_symptomsFlat', weight: 0.20 },
    { name: 'description',   weight: 0.10 },
    { name: '_causesFlat',   weight: 0.07 },
  ],
  threshold:          0.45,
  includeScore:       true,
  ignoreLocation:     true,
  minMatchCharLength: 3,
});

// ---------------------------------------------------------------------------
// Medicine Fuse index — searched on the extracted name, not the full sentence.
// High weight on name + generic_name so "paracetamol" always beats false hits.
// ---------------------------------------------------------------------------
const MEDICINE_LIST = medicines.map(m => ({
  ...m,
  _usesFlat: Array.isArray(m.uses) ? m.uses.join(' ') : (m.uses || ''),
}));

const medicineFuse = new Fuse(MEDICINE_LIST, {
  keys: [
    { name: 'name',         weight: 0.50 },
    { name: 'generic_name', weight: 0.35 },
    { name: '_usesFlat',    weight: 0.10 },
    { name: 'category',     weight: 0.05 },
  ],
  threshold:          0.35,   // strict — we only match actual medicine names
  includeScore:       true,
  ignoreLocation:     true,
  minMatchCharLength: 3,
});

// ---------------------------------------------------------------------------
// extractMedicineName — strips common question patterns from a query and
// returns the likely medicine name so Fuse can search on just the name.
//
// Examples:
//   "tell me about paracetamol"  → "paracetamol"
//   "what is ibuprofen?"         → "ibuprofen"
//   "dosage for aspirin"         → "aspirin"
//   "paracetamol"                → "paracetamol"  (unchanged)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// extractMedicineName — multi-pass extraction that handles:
//   Prefix:  "tell me about X" / "what is X" / "how to take X"
//   Interior: "what is the dosage for X" / "what are the uses of X"
//   Suffix:  "X medicine" / "X tablet" / "X dosage"
//   Articles: strips leftover "the", "a", "an"
// ---------------------------------------------------------------------------
function extractMedicineName(text) {
  let c = text.trim().replace(/\?$/, '').trim();

  // Pass 1 — question-word prefixes
  c = c.replace(/^(?:tell me about|what is|what are|how does|how do i use|how to use)\s+/i, '').trim();
  c = c.replace(/^(?:information about|info on|info about|details about|details on)\s+/i, '').trim();
  c = c.replace(/^(?:can i take|should i take|when to take|how to take)\s+/i, '').trim();

  // Pass 2 — interior descriptors that expose the medicine name after them
  c = c.replace(/^(?:the\s+)?dosage\s+(?:for|of)\s+/i, '').trim();
  c = c.replace(/^(?:the\s+)?dose\s+(?:for|of)\s+/i, '').trim();
  c = c.replace(/^(?:the\s+)?side\s+effects?\s+of\s+/i, '').trim();
  c = c.replace(/^(?:the\s+)?uses?\s+of\s+/i, '').trim();
  c = c.replace(/^(?:the\s+)?warnings?\s+(?:for|of|about)\s+/i, '').trim();
  c = c.replace(/^(?:the\s+)?interactions?\s+(?:for|of|with)\s+/i, '').trim();

  // Pass 3 — leading articles / prepositions left over
  c = c.replace(/^(?:the|a|an|for|of|about)\s+/i, '').trim();

  // Pass 4 — trailing descriptor words
  c = c.replace(/\s+(?:medicine|medication|drug|tablet|tablets|pill|pills|capsule|capsules|syrup|injection|information|info|dosage|dose|side\s+effects|uses|warnings)$/i, '').trim();

  return c.length >= 3 ? c : text.trim().replace(/\?$/, '').trim();
}

// ---------------------------------------------------------------------------
// isMedicineQuery — quick heuristic: returns true when the query is clearly
// asking about a medicine rather than describing symptoms.
// ---------------------------------------------------------------------------
const MEDICINE_QUERY_TRIGGERS = [
  'tell me about', 'what is', 'what are', 'dosage for', 'dosage of',
  'side effects', 'uses of', 'use of', 'information about', 'info on',
  'how to take', 'can i take', 'should i take', 'dose of', 'dose for',
];

function isMedicineQuery(text) {
  const lower = text.toLowerCase();
  return MEDICINE_QUERY_TRIGGERS.some(t => lower.includes(t));
}

// ---------------------------------------------------------------------------
// searchCategories — returns top-N matched KB categories for a free-text query.
// Returns: [{ category, score: 0-100, id }]
// ---------------------------------------------------------------------------
function searchCategories(query, limit = 3) {
  if (!query || typeof query !== 'string' || !query.trim()) return [];

  const results = categoryFuse.search(query.trim());
  return results
    .slice(0, limit)
    .map(r => ({
      category: r.item,
      id:       r.item.id,
      score:    Math.round((1 - (r.score || 0)) * 100),
    }))
    // Filter out very weak matches to prevent spurious responses
    .filter(r => r.score >= 25);
}

// ---------------------------------------------------------------------------
// searchMedicines — finds medicines matching the query.
// Automatically extracts the medicine name from phrased queries.
// Returns: [<medicine object>]
// ---------------------------------------------------------------------------
function searchMedicines(query, limit = 5) {
  if (!query || typeof query !== 'string' || !query.trim()) return [];

  // Extract the medicine name from question phrasing before searching
  const searchTerm = extractMedicineName(query.trim());
  const results    = medicineFuse.search(searchTerm);
  return results.slice(0, limit).map(r => r.item);
}

// ---------------------------------------------------------------------------
// searchAll — convenience wrapper that searches both indexes at once.
// ---------------------------------------------------------------------------
function searchAll(query) {
  return {
    categories: searchCategories(query, 3),
    medicines:  searchMedicines(query, 3),
  };
}

module.exports = { searchCategories, searchMedicines, searchAll, isMedicineQuery, extractMedicineName };
