'use strict';
const kb = require('./medical_kb.json');

// ---------------------------------------------------------------------------
// Stopwords — common words that carry no diagnostic meaning
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they',
  'them', 'his', 'her', 'its', 'their', 'am', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'at',
  'by', 'from', 'to', 'in', 'on', 'of', 'up', 'as', 'if', 'then', 'than',
  'that', 'this', 'these', 'those', 'with', 'about', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off',
  'over', 'under', 'again', 'further', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'not', 'only', 'same', 'too', 'very',
  'just', 'also', 'even', 'though', 'while', 'since', 'until', 'unless',
  'feel', 'feeling', 'felt', 'having', 'getting', 'got', 'get', 'had',
  'really', 'quite', 'bit', 'little', 'lot', 'much', 'many', 'bad', 'good',
  'right', 'well', 'like', 'know', 'think', 'going', 'been', 'what', 'who'
]);

// ---------------------------------------------------------------------------
// Tokenize — lowercases and splits into words, preserving multi-word phrases
// ---------------------------------------------------------------------------
function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

// ---------------------------------------------------------------------------
// Basic stemmer — reduces words to a root form for better matching
// ---------------------------------------------------------------------------
function stem(word) {
  if (!word || word.length < 4) return word;
  word = word.toLowerCase();
  // Common medical/symptom endings
  const rules = [
    [/ing$/, ''],
    [/ings$/, ''],
    [/ness$/, ''],
    [/tion$/, ''],
    [/sion$/, ''],
    [/ment$/, ''],
    [/ache$/, 'ach'],
    [/aches$/, 'ach'],
    [/aching$/, 'ach'],
    [/pain$/, 'pain'],
    [/pains$/, 'pain'],
    [/painful$/, 'pain'],
    [/cramp$/, 'cramp'],
    [/cramps$/, 'cramp'],
    [/cramping$/, 'cramp'],
    [/sweat$/, 'sweat'],
    [/sweating$/, 'sweat'],
    [/sweats$/, 'sweat'],
    [/ies$/, 'y'],
    [/es$/, ''],
    [/s$/, ''],
    [/ed$/, ''],
    [/er$/, ''],
    [/ly$/, ''],
  ];
  for (const [pattern, replacement] of rules) {
    if (word.length > 4 && pattern.test(word)) {
      const stemmed = word.replace(pattern, replacement);
      if (stemmed.length >= 3) return stemmed;
    }
  }
  return word;
}

// ---------------------------------------------------------------------------
// Build a flat list of all recognisable symptom phrases from the symptom_map.
// Sorted longest-first so multi-word phrases are matched before single words.
// ---------------------------------------------------------------------------
const ALL_SYMPTOM_PHRASES = (() => {
  const seen = new Set();
  const phrases = [];
  for (const [categoryId, phraseList] of Object.entries(kb.symptom_map)) {
    for (const phrase of phraseList) {
      const norm = phrase.toLowerCase().trim();
      if (!seen.has(norm)) {
        seen.add(norm);
        phrases.push({ phrase: norm, categoryId });
      }
    }
  }
  // Also add trigger_keywords from categories
  for (const [categoryId, category] of Object.entries(kb.categories)) {
    for (const kw of (category.trigger_keywords || [])) {
      const norm = kw.toLowerCase().trim();
      if (!seen.has(norm)) {
        seen.add(norm);
        phrases.push({ phrase: norm, categoryId });
      }
    }
  }
  // Sort: multi-word phrases first, then by length descending for greedy match
  phrases.sort((a, b) => {
    const aWords = a.phrase.split(' ').length;
    const bWords = b.phrase.split(' ').length;
    if (aWords !== bWords) return bWords - aWords;
    return b.phrase.length - a.phrase.length;
  });
  return phrases;
})();

// ---------------------------------------------------------------------------
// Symptom synonyms — map user words to recognised phrases
// ---------------------------------------------------------------------------
const SYNONYMS = {
  'sweat': 'sweating',
  'sweats': 'sweating',
  'sweatiness': 'sweating',
  'perspire': 'sweating',
  'perspiring': 'sweating',
  'perspiration': 'sweating',
  'spasm': 'muscle cramp',
  'spasms': 'muscle cramp',
  'cramping': 'cramps',
  'cramped': 'cramps',
  'cramp': 'cramps',
  'ache': 'pain',
  'aching': 'pain',
  'sore': 'pain',
  'soreness': 'pain',
  'hurt': 'pain',
  'hurts': 'pain',
  'hurting': 'pain',
  'throbbing': 'pain',
  'stiff': 'stiffness',
  'numb': 'numbness',
  'numbing': 'numbness',
  'tingling': 'tingling hand',
  'dizzy': 'dizziness',
  'dizziness': 'dizziness',
  'lightheaded': 'dizziness',
  'faint': 'fainting',
  'fainting': 'fainting',
  'tired': 'fatigue',
  'tiredness': 'fatigue',
  'exhausted': 'fatigue',
  'exhaustion': 'fatigue',
  'sick': 'nausea',
  'vomit': 'vomiting',
  'vomited': 'vomiting',
  'nauseous': 'nausea',
  'queasy': 'nausea',
  'high temp': 'fever',
  'temperature': 'fever',
  'temp': 'fever',
  'feverish': 'fever',
  'coughing': 'cough',
  'blocked nose': 'congestion',
  'stuffy': 'congestion',
  'stuffiness': 'congestion',
  'runny': 'runny nose',
  'sneeze': 'sneezing',
  'sneezes': 'sneezing',
  'thirsty': 'thirst',
  'dehydrated': 'dehydration',
  'dry': 'dry mouth',
  'diabetic': 'diabetes',
  'sugar': 'blood sugar',
  'bp': 'blood pressure',
  'hyper': 'hypertension',
  'hypertensive': 'hypertension',
  'hypotension': 'low bp',
  'migraine': 'headache',
  'heartburn': 'stomach pain',
  'acid': 'stomach pain',
  'tummy': 'stomach pain',
  'belly': 'belly pain',
  'bruised': 'bruise',
  'cut': 'cut',
  'burns': 'burn',
  'burned': 'burn',
  'burnt': 'burn',
  'sprained': 'sprain',
  'broken': 'fracture',
  'fracture': 'fracture',
  'unconscious': 'unconscious',
  'unresponsive': 'not responding',
  'collapse': 'collapsed',
  'passed out': 'unconscious',
};

// ---------------------------------------------------------------------------
// extractSymptoms — finds symptom phrases in the user's raw text.
// Returns an array of unique matched phrase strings.
// ---------------------------------------------------------------------------
function extractSymptoms(text) {
  if (!text || typeof text !== 'string') return [];

  let normalised = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();

  // Apply synonyms: replace known user words with canonical phrases
  for (const [userWord, canonical] of Object.entries(SYNONYMS)) {
    const regex = new RegExp(`\\b${userWord.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
    normalised = normalised.replace(regex, canonical);
  }

  const found = new Set();
  let remaining = ' ' + normalised + ' ';

  // Pass 1: match multi-word phrases (greedy, longest first)
  for (const { phrase } of ALL_SYMPTOM_PHRASES) {
    const escapedPhrase = phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?<![a-z])${escapedPhrase}(?![a-z])`, 'i');
    if (regex.test(remaining)) {
      found.add(phrase);
    }
  }

  // Pass 2: token-level stemmed matching for any tokens not yet captured
  const tokens = tokenize(normalised);
  for (const token of tokens) {
    const stemmedToken = stem(token);
    for (const { phrase } of ALL_SYMPTOM_PHRASES) {
      if (found.has(phrase)) continue;
      const phraseParts = phrase.split(' ');
      if (phraseParts.length === 1) {
        const stemmedPhrase = stem(phrase);
        if (stemmedToken === stemmedPhrase || token === phrase) {
          found.add(phrase);
        }
      }
    }
  }

  return Array.from(found);
}

// ---------------------------------------------------------------------------
// mapToCategories — scores each KB category against the extracted symptoms.
// Returns an object: { categoryId: score }
// ---------------------------------------------------------------------------
function mapToCategories(symptoms, rawText) {
  const scores = {};
  const normText = (rawText || '').toLowerCase();

  // Build a reverse map: phrase -> [categoryId, ...]
  const phraseToCategories = {};
  for (const { phrase, categoryId } of ALL_SYMPTOM_PHRASES) {
    if (!phraseToCategories[phrase]) phraseToCategories[phrase] = new Set();
    phraseToCategories[phrase].add(categoryId);
  }

  // Score each matched symptom
  for (const symptom of symptoms) {
    const categoryIds = phraseToCategories[symptom];
    if (categoryIds) {
      for (const catId of categoryIds) {
        scores[catId] = (scores[catId] || 0) + 2; // Base score per symptom match
      }
    }
  }

  // Direct keyword scan of the raw text against each category's trigger_keywords
  for (const [catId, category] of Object.entries(kb.categories)) {
    for (const kw of (category.trigger_keywords || [])) {
      if (normText.includes(kw.toLowerCase())) {
        scores[catId] = (scores[catId] || 0) + 1;
      }
    }
  }

  // Multi-symptom combination bonuses
  // These reward categories that match multiple extracted symptoms
  for (const [catId] of Object.entries(scores)) {
    const category = kb.categories[catId];
    if (!category) continue;
    const catSymptoms = (category.symptoms || []).map(s => s.toLowerCase());
    let combinationBonus = 0;
    for (const symptom of symptoms) {
      if (catSymptoms.some(s => s.includes(symptom) || symptom.includes(s.split(' ')[0]))) {
        combinationBonus += 1;
      }
    }
    if (combinationBonus > 1) {
      scores[catId] = (scores[catId] || 0) + combinationBonus;
    }
  }

  // CRITICAL CORRECTION: Prevent "sweating" alone from unduly boosting "fever".
  // Sweating in the context of cramps/hand pain is NOT fever-related.
  // If muscle_cramps or hand_pain are present and fever is NOT a primary signal,
  // reduce the fever score.
  const hasFeverSignal = symptoms.some(s =>
    ['fever', 'temperature', 'feverish', 'burning up', 'high temp', 'pyrexia'].includes(s)
  );
  const hasCreampSignal = symptoms.some(s =>
    s.includes('cramp') || s.includes('spasm') || s.includes('muscle')
  );
  const hasHandSignal = symptoms.some(s =>
    s.includes('hand') || s.includes('wrist') || s.includes('finger')
  );

  if (!hasFeverSignal && (hasCreampSignal || hasHandSignal)) {
    // Heavily penalise fever score when cramps/hand pain are the main issue
    if (scores['fever']) {
      scores['fever'] = Math.max(0, scores['fever'] - 4);
    }
  }

  // Bonus: if both dehydration signals AND cramp signals present, boost both
  const hasDehydrationSignal = symptoms.some(s =>
    ['thirst', 'dehydration', 'dehydrated', 'dry mouth', 'dark urine', 'sweating'].includes(s)
  );
  if (hasDehydrationSignal && hasCreampSignal) {
    scores['dehydration'] = (scores['dehydration'] || 0) + 3;
    scores['muscle_cramps'] = (scores['muscle_cramps'] || 0) + 3;
  }

  // Bonus: if sweating + hand signals, boost hand_pain and muscle_cramps
  const hasSweatingSignal = normText.includes('sweat') ||
    symptoms.some(s => s.includes('sweat'));
  if (hasSweatingSignal && hasHandSignal) {
    scores['hand_pain'] = (scores['hand_pain'] || 0) + 2;
    scores['muscle_cramps'] = (scores['muscle_cramps'] || 0) + 2;
  }

  return scores;
}

// ---------------------------------------------------------------------------
// calcConfidence — normalises raw score to a 0-100 percentage
// Uses a BM25-inspired normalisation adjusted for our scoring scale
// ---------------------------------------------------------------------------
function calcConfidence(categoryScore, totalSymptoms, maxPossibleScore) {
  if (!categoryScore || categoryScore <= 0) return 0;
  if (!maxPossibleScore || maxPossibleScore <= 0) maxPossibleScore = 20;

  // Saturation curve: high scores converge toward 95%, low toward 30%
  const rawRatio = categoryScore / maxPossibleScore;
  const k = 1.5; // Saturation constant
  const normalized = rawRatio * (k + 1) / (rawRatio + k);

  // Floor: at least 30% if any match at all
  const confidence = Math.round(Math.max(30, Math.min(95, normalized * 100)));
  return confidence;
}

// ---------------------------------------------------------------------------
// match — main entry point. Matches user text against the KB.
// Returns:
//   {
//     matches: [{ category, score, confidence }],  // top 3 sorted by score
//     extractedSymptoms: string[]
//   }
// ---------------------------------------------------------------------------
function match(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return { matches: [], extractedSymptoms: [] };
  }

  const extractedSymptoms = extractSymptoms(text);
  const scores = mapToCategories(extractedSymptoms, text);

  // Find max score for confidence normalisation
  const maxScore = Object.values(scores).reduce((a, b) => Math.max(a, b), 0);

  // Build sorted results
  const results = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .map(([categoryId, score]) => ({
      category: kb.categories[categoryId] || null,
      categoryId,
      score,
      confidence: calcConfidence(score, extractedSymptoms.length, maxScore),
    }))
    .filter(r => r.category !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3); // Top 3

  return {
    matches: results,
    extractedSymptoms,
  };
}

module.exports = { match, extractSymptoms, tokenize, stem };
