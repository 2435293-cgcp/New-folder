'use strict';

/**
 * fuse_search.js — Fuse.js powered search over the medical knowledge base.
 *
 * Provides two independent fuzzy search indexes:
 *   1. categoryFuse  — searches KB categories by trigger_keywords, symptoms, description
 *   2. medicineFuse  — searches medicines.json by name, generic name, and uses
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
// The Fuse index needs a plain array; we flatten the nested structure here.
// ---------------------------------------------------------------------------
const KB_CATEGORY_LIST = Object.values(medicalKb.categories || {}).map(cat => ({
  // Keep the full category object so callers get all fields back
  ...cat,
  // Concatenate arrays into searchable strings for Fuse.js
  _keywordsFlat: (cat.trigger_keywords || []).join(' '),
  _symptomsFlat: (cat.symptoms || []).join(' '),
  _causesFlat:   (cat.common_causes || []).join(' '),
  _careFlat:     (cat.home_care || []).join(' '),
}));

// ---------------------------------------------------------------------------
// Category Fuse index
// Weights: trigger_keywords > name > symptoms > description > causes
// Threshold 0.42 — loose enough to catch partial / misspelled queries.
// ---------------------------------------------------------------------------
const categoryFuse = new Fuse(KB_CATEGORY_LIST, {
  keys: [
    { name: '_keywordsFlat', weight: 0.38 },
    { name: 'name',          weight: 0.25 },
    { name: '_symptomsFlat', weight: 0.20 },
    { name: 'description',   weight: 0.10 },
    { name: '_causesFlat',   weight: 0.07 },
  ],
  threshold:         0.42,
  includeScore:      true,
  ignoreLocation:    true,
  minMatchCharLength: 3,
  useExtendedSearch: false,
});

// ---------------------------------------------------------------------------
// Medicine Fuse index
// Weights: name > generic_name > uses > category
// ---------------------------------------------------------------------------
const MEDICINE_LIST = medicines.map(m => ({
  ...m,
  _usesFlat: Array.isArray(m.uses) ? m.uses.join(' ') : (m.uses || ''),
}));

const medicineFuse = new Fuse(MEDICINE_LIST, {
  keys: [
    { name: 'name',         weight: 0.40 },
    { name: 'generic_name', weight: 0.30 },
    { name: '_usesFlat',    weight: 0.20 },
    { name: 'category',     weight: 0.10 },
  ],
  threshold:         0.40,
  includeScore:      true,
  ignoreLocation:    true,
  minMatchCharLength: 3,
});

// ---------------------------------------------------------------------------
// searchCategories — returns top-N matched KB categories for a free-text query.
//
// Returns: [{ category: <full category object>, score: 0-100, id: string }]
// ---------------------------------------------------------------------------
function searchCategories(query, limit = 3) {
  if (!query || typeof query !== 'string' || !query.trim()) return [];

  const results = categoryFuse.search(query.trim());
  return results.slice(0, limit).map(r => ({
    category: r.item,
    id:       r.item.id,
    score:    Math.round((1 - (r.score || 0)) * 100),
  }));
}

// ---------------------------------------------------------------------------
// searchMedicines — returns top-N matched medicines for a free-text query.
//
// Returns: [<medicine object>]  (same shape as medicines.json entries)
// ---------------------------------------------------------------------------
function searchMedicines(query, limit = 5) {
  if (!query || typeof query !== 'string' || !query.trim()) return [];

  const results = medicineFuse.search(query.trim());
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

module.exports = { searchCategories, searchMedicines, searchAll };
