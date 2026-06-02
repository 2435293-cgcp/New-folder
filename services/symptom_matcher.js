'use strict';
const kb = require('../data/medical_kb.json');

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

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

function stem(word) {
  if (!word || word.length < 4) return word;
  word = word.toLowerCase();
  const rules = [
    [/ing$/, ''], [/ings$/, ''], [/ness$/, ''], [/tion$/, ''], [/sion$/, ''],
    [/ment$/, ''], [/ache$/, 'ach'], [/aches$/, 'ach'], [/aching$/, 'ach'],
    [/pain$/, 'pain'], [/pains$/, 'pain'], [/painful$/, 'pain'],
    [/cramp$/, 'cramp'], [/cramps$/, 'cramp'], [/cramping$/, 'cramp'],
    [/sweat$/, 'sweat'], [/sweating$/, 'sweat'], [/sweats$/, 'sweat'],
    [/ies$/, 'y'], [/es$/, ''], [/s$/, ''], [/ed$/, ''], [/er$/, ''], [/ly$/, ''],
  ];
  for (const [pattern, replacement] of rules) {
    if (word.length > 4 && pattern.test(word)) {
      const stemmed = word.replace(pattern, replacement);
      if (stemmed.length >= 3) return stemmed;
    }
  }
  return word;
}

const ALL_SYMPTOM_PHRASES = (() => {
  const seen = new Set();
  const phrases = [];
  for (const [categoryId, phraseList] of Object.entries(kb.symptom_map)) {
    for (const phrase of phraseList) {
      const norm = phrase.toLowerCase().trim();
      if (!seen.has(norm)) { seen.add(norm); phrases.push({ phrase: norm, categoryId }); }
    }
  }
  for (const [categoryId, category] of Object.entries(kb.categories)) {
    for (const kw of (category.trigger_keywords || [])) {
      const norm = kw.toLowerCase().trim();
      if (!seen.has(norm)) { seen.add(norm); phrases.push({ phrase: norm, categoryId }); }
    }
  }
  phrases.sort((a, b) => {
    const aW = a.phrase.split(' ').length;
    const bW = b.phrase.split(' ').length;
    if (aW !== bW) return bW - aW;
    return b.phrase.length - a.phrase.length;
  });
  return phrases;
})();

const SYNONYMS = {
  'sweat': 'sweating', 'sweats': 'sweating', 'perspire': 'sweating', 'perspiring': 'sweating',
  'spasm': 'muscle cramp', 'spasms': 'muscle cramp', 'cramping': 'cramps', 'cramped': 'cramps', 'cramp': 'cramps',
  'ache': 'pain', 'aching': 'pain', 'sore': 'pain', 'soreness': 'pain',
  'hurt': 'pain', 'hurts': 'pain', 'hurting': 'pain', 'throbbing': 'pain',
  'stiff': 'stiffness', 'numb': 'numbness', 'numbing': 'numbness', 'tingling': 'tingling hand',
  'dizzy': 'dizziness', 'lightheaded': 'dizziness', 'faint': 'fainting',
  'tired': 'fatigue', 'tiredness': 'fatigue', 'exhausted': 'fatigue',
  'sick': 'nausea', 'vomit': 'vomiting', 'nauseous': 'nausea', 'queasy': 'nausea',
  'high temp': 'fever', 'temperature': 'fever', 'temp': 'fever', 'feverish': 'fever',
  'coughing': 'cough', 'blocked nose': 'congestion', 'stuffy': 'congestion', 'runny': 'runny nose',
  'sneeze': 'sneezing', 'thirsty': 'thirst', 'dehydrated': 'dehydration', 'dry': 'dry mouth',
  'diabetic': 'diabetes', 'sugar': 'blood sugar', 'bp': 'blood pressure',
  'hyper': 'hypertension', 'hypertensive': 'hypertension', 'migraine': 'headache',
  'heartburn': 'stomach pain', 'acid': 'stomach pain', 'tummy': 'stomach pain',
  'bruised': 'bruise', 'burns': 'burn', 'burned': 'burn', 'burnt': 'burn',
  'sprained': 'sprain', 'broken': 'fracture', 'unconscious': 'unconscious',
  'unresponsive': 'not responding', 'collapse': 'collapsed', 'passed out': 'unconscious',
};

function extractSymptoms(text) {
  if (!text || typeof text !== 'string') return [];
  let normalised = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  for (const [userWord, canonical] of Object.entries(SYNONYMS)) {
    const regex = new RegExp(`\\b${userWord.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
    normalised = normalised.replace(regex, canonical);
  }

  const found = new Set();
  let remaining = ' ' + normalised + ' ';

  for (const { phrase } of ALL_SYMPTOM_PHRASES) {
    const escaped = phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i');
    if (regex.test(remaining)) found.add(phrase);
  }

  const tokens = tokenize(normalised);
  for (const token of tokens) {
    const stemmedToken = stem(token);
    for (const { phrase } of ALL_SYMPTOM_PHRASES) {
      if (found.has(phrase)) continue;
      const phraseParts = phrase.split(' ');
      if (phraseParts.length === 1) {
        const stemmedPhrase = stem(phrase);
        if (stemmedToken === stemmedPhrase || token === phrase) found.add(phrase);
      }
    }
  }

  return Array.from(found);
}

function mapToCategories(symptoms, rawText) {
  const scores = {};
  const normText = (rawText || '').toLowerCase();

  const phraseToCategories = {};
  for (const { phrase, categoryId } of ALL_SYMPTOM_PHRASES) {
    if (!phraseToCategories[phrase]) phraseToCategories[phrase] = new Set();
    phraseToCategories[phrase].add(categoryId);
  }

  for (const symptom of symptoms) {
    const catIds = phraseToCategories[symptom];
    if (catIds) {
      for (const catId of catIds) { scores[catId] = (scores[catId] || 0) + 2; }
    }
  }

  for (const [catId, category] of Object.entries(kb.categories)) {
    for (const kw of (category.trigger_keywords || [])) {
      if (normText.includes(kw.toLowerCase())) { scores[catId] = (scores[catId] || 0) + 1; }
    }
  }

  for (const [catId] of Object.entries(scores)) {
    const category = kb.categories[catId];
    if (!category) continue;
    const catSymptoms = (category.symptoms || []).map(s => s.toLowerCase());
    let bonus = 0;
    for (const symptom of symptoms) {
      if (catSymptoms.some(s => s.includes(symptom) || symptom.includes(s.split(' ')[0]))) bonus++;
    }
    if (bonus > 1) scores[catId] = (scores[catId] || 0) + bonus;
  }

  const hasFeverSignal = symptoms.some(s => ['fever', 'temperature', 'feverish', 'burning up', 'high temp', 'pyrexia'].includes(s));
  const hasCrampSignal = symptoms.some(s => s.includes('cramp') || s.includes('spasm') || s.includes('muscle'));
  const hasHandSignal = symptoms.some(s => s.includes('hand') || s.includes('wrist') || s.includes('finger'));

  if (!hasFeverSignal && (hasCrampSignal || hasHandSignal)) {
    if (scores['fever']) scores['fever'] = Math.max(0, scores['fever'] - 4);
  }

  const hasDehydrationSignal = symptoms.some(s => ['thirst', 'dehydration', 'dehydrated', 'dry mouth', 'dark urine', 'sweating'].includes(s));
  if (hasDehydrationSignal && hasCrampSignal) {
    scores['dehydration'] = (scores['dehydration'] || 0) + 3;
    scores['muscle_cramps'] = (scores['muscle_cramps'] || 0) + 3;
  }

  const hasSweatingSignal = normText.includes('sweat') || symptoms.some(s => s.includes('sweat'));
  if (hasSweatingSignal && hasHandSignal) {
    scores['hand_pain'] = (scores['hand_pain'] || 0) + 2;
    scores['muscle_cramps'] = (scores['muscle_cramps'] || 0) + 2;
  }

  return scores;
}

function calcConfidence(categoryScore, totalSymptoms, maxPossibleScore) {
  if (!categoryScore || categoryScore <= 0) return 0;
  if (!maxPossibleScore || maxPossibleScore <= 0) maxPossibleScore = 20;
  const rawRatio = categoryScore / maxPossibleScore;
  const k = 1.5;
  const normalized = rawRatio * (k + 1) / (rawRatio + k);
  return Math.round(Math.max(30, Math.min(95, normalized * 100)));
}

function match(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { matches: [], extractedSymptoms: [] };
  }

  const extractedSymptoms = extractSymptoms(text);
  const scores = mapToCategories(extractedSymptoms, text);
  const maxScore = Object.values(scores).reduce((a, b) => Math.max(a, b), 0);

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
    .slice(0, 3);

  return { matches: results, extractedSymptoms };
}

module.exports = { match, extractSymptoms, tokenize, stem };
