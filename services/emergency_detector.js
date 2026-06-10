'use strict';
const kb = require('../data/medical_kb.json');

const EMERGENCY_PATTERNS = {
  heart_attack: [
    /\bchest\s*(pain|tight|pressure|hurt|heavy|discomfort|squeeze)/i,
    /\bleft\s*(arm|hand|shoulder)\s*(pain|numb|tingle|tingling|ache|weak)/i,
    /\bjaw\s*(pain|ache|tight)/i,
    /\bsudden\s*(sweat|dizziness|dizzy|weakness)/i,
    /\barm\s*pain.*sweat|sweat.*arm\s*pain/i,
    /\bangina/i, /\bmyocardial/i, /\bheart\s*attack/i,
  ],
  stroke: [
    /\bface\s*(droop|drooping|numb|weak|paralys)/i,
    /\b(speech|talking|speaking)\s*(difficult|slur|slurred|unclear|confused|problem)/i,
    /\bsudden\s*(headache|confusion|confus|vision|weakness|numb)/i,
    /\barm\s*(weak|weakness|numb|cannot\s*lift|can't\s*lift|limp)/i,
    /\bstroke\b/i, /\bfast\s*(face|arm|speech)/i,
    /\bsuddenly\s*(cannot|can't)\s*(speak|talk|move|see)/i, /\bslurred?\s*speech/i,
  ],
  breathing: [
    /\bcan\s*not\s*breath/i, /\bcan't\s*breath/i, /\bcannot\s*breath/i,
    /\bdifficulty\s*breath/i, /\bhard\s*to\s*breath/i,
    /\bshort\s*of\s*breath/i, /\bshortness\s*of\s*breath/i,
    /\bsob\b/i, /\bchok(e|ing|ed)\b/i, /\bblue\s*lips/i,
    /\bturning\s*blue/i, /\bcyanosis/i, /\bno\s*air/i,
    /\bsevere\s*asthma/i, /\bwheezing\s*(badly|severe|bad)/i,
  ],
  severe_bleeding: [
    /\bsevere\s*bleed/i, /\bheavy\s*bleed/i,
    /\bcannot\s*stop\s*bleed/i, /\bcan't\s*stop\s*bleed/i,
    /\bbleed(ing)?\s*(a\s*lot|heavily|profusely|uncontrolled|won't\s*stop)/i,
    /\bblood\s*(gushing|pouring|spurting)/i, /\barterial\s*bleed/i,
  ],
  loss_of_consciousness: [
    /\bunconsci(ous|ousness)\b/i, /\bfaint(ed|ing|s)?\b/i,
    /\bnot\s*(responding|waking|conscious|alert)/i,
    /\bcollapse(d|s|ing)?\b/i, /\bpassed?\s*out\b/i,
    /\blost\s*consciousness/i, /\bunresponsive\b/i,
  ],
  seizure: [
    /\bseizure\b/i, /\bconvuls(e|ing|ion|ions)\b/i, /\bfitting\b/i,
    /\bepilep(sy|tic|tic\s*fit)\b/i,
    /\bshaking\s*(uncontrollably|violently)/i,
    /\bjerk(ing)?\s*(movements|uncontrollably)/i,
  ],
  overdose_poisoning: [
    /\boverdose\b/i, /\btook\s*too\s*many\s*(pills|tablets|drugs)/i,
    /\bpoisoning\b/i, /\bpoisoned\b/i,
    /\bingested\s*(chemical|toxic|poison)/i,
    /\bswallowed\s*(something\s*)?(toxic|poison|chemical)/i,
  ],
  anaphylaxis: [
    /\bthroat\s*(closing|swelling|swollen|tight)/i,
    /\btongue\s*(swelling|swollen)/i,
    /\banaphyla(xis|ctic)\b/i, /\bsevere\s*(allerg|allergic\s*reaction)/i,
    /\bcannot\s*swallow/i, /\bairway\s*(blocked|closing|swelling)/i, /\bepipen\b/i,
  ],
};

const EMERGENCY_META = {
  heart_attack: {
    name: 'Possible Heart Attack',
    severity: 'critical',
    message: 'The symptoms you have described — especially chest pain, left arm/hand pain, or sweating — can be warning signs of a heart attack.',
    action: 'Call emergency services (911 / 112 / 999) immediately. Do NOT drive yourself. While waiting: sit or lie comfortably, loosen tight clothing, and chew one aspirin (325mg) if not allergic.',
  },
  stroke: {
    name: 'Possible Stroke — Act FAST',
    severity: 'critical',
    message: 'These symptoms may indicate a stroke. Remember FAST: Face drooping, Arm weakness, Speech difficulty, Time to call.',
    action: 'Call emergency services (911 / 112 / 999) immediately. Note the exact time symptoms started — critical for treatment. Do not give food or drink.',
  },
  breathing: {
    name: 'Breathing Emergency',
    severity: 'critical',
    message: 'Severe difficulty breathing is a life-threatening emergency requiring immediate help.',
    action: 'Call emergency services (911 / 112 / 999) immediately. Sit upright and stay calm. Use your inhaler now if you have one for asthma.',
  },
  severe_bleeding: {
    name: 'Severe Bleeding',
    severity: 'critical',
    message: 'Heavy or uncontrolled bleeding is a serious emergency.',
    action: 'Apply firm, direct pressure with a clean cloth. Do not remove cloth if it soaks through — add more on top. Call emergency services immediately.',
  },
  loss_of_consciousness: {
    name: 'Loss of Consciousness',
    severity: 'critical',
    message: 'Unconsciousness or unresponsiveness is a medical emergency.',
    action: 'Check if the person is breathing. If not: call emergency services and begin CPR. If breathing: place in recovery position and call for help.',
  },
  seizure: {
    name: 'Seizure',
    severity: 'critical',
    message: 'A seizure requires careful management and medical assessment.',
    action: 'Protect from injury — clear the area. Do NOT restrain or put anything in their mouth. Time the seizure. Call emergency if it lasts more than 5 minutes.',
  },
  overdose_poisoning: {
    name: 'Possible Overdose or Poisoning',
    severity: 'critical',
    message: 'A suspected overdose or poisoning is a medical emergency.',
    action: 'Call emergency services (911 / 112 / 999) or Poison Control immediately. Keep person awake if possible. Do not induce vomiting unless instructed.',
  },
  anaphylaxis: {
    name: 'Severe Allergic Reaction (Anaphylaxis)',
    severity: 'critical',
    message: 'Throat or tongue swelling can block your airway — immediately life-threatening.',
    action: 'Use an EpiPen if available, then call emergency services immediately. Lay flat with legs raised unless breathing is difficult — then sit up.',
  },
};

const COMBINATION_ALERTS = [
  { symptoms: ['left hand', 'sweat'],  type: 'heart_attack', required: 2,
    message: 'Left hand pain combined with sweating can be early warning signs of a cardiac event.' },
  { symptoms: ['left arm', 'sweat'],   type: 'heart_attack', required: 2,
    message: 'Left arm discomfort combined with sweating may indicate a cardiac event.' },
  { symptoms: ['chest', 'sweat'],      type: 'heart_attack', required: 2,
    message: 'Chest discomfort combined with sweating may indicate a cardiac event.' },
  { symptoms: ['chest', 'left arm'],   type: 'heart_attack', required: 2,
    message: 'Chest pain with left arm involvement is a classic sign of a heart attack.' },
  { symptoms: ['chest', 'jaw'],        type: 'heart_attack', required: 2,
    message: 'Chest pain combined with jaw pain can indicate cardiac involvement.' },
  { symptoms: ['chest', 'nausea', 'sweat'], type: 'heart_attack', required: 3,
    message: 'Chest discomfort with nausea and sweating is a known cardiac warning combination.' },
  { symptoms: ['left hand', 'cramp', 'sweat'], type: 'heart_attack', required: 3,
    message: 'Left hand cramping with sweating — while often muscular — should be evaluated for cardiac causes if severe.' },
  { symptoms: ['face', 'arm', 'speech'], type: 'stroke', required: 2,
    message: 'Face, arm, and speech problems together are classic stroke signs — act FAST.' },
  { symptoms: ['throat', 'swelling', 'allerg'], type: 'anaphylaxis', required: 2,
    message: 'Throat swelling in the context of an allergic reaction is anaphylaxis.' },
];

function detect(text) {
  if (!text || typeof text !== 'string' || !text.trim()) return null;

  for (const [type, patterns] of Object.entries(EMERGENCY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        const meta = EMERGENCY_META[type];
        return { type, name: meta.name, message: meta.message, action: meta.action, severity: meta.severity, detectionMethod: 'pattern' };
      }
    }
  }

  const lower = text.toLowerCase();
  for (const combo of COMBINATION_ALERTS) {
    let matchCount = 0;
    const matchedSymptoms = [];
    for (const fragment of combo.symptoms) {
      if (lower.includes(fragment)) { matchCount++; matchedSymptoms.push(fragment); }
    }
    if (matchCount >= combo.required) {
      const meta = EMERGENCY_META[combo.type];
      return { type: combo.type, name: meta.name, message: combo.message, action: meta.action, severity: meta.severity, detectionMethod: 'combination', matchedSymptoms };
    }
  }

  for (const emergencyCombo of (kb.emergency_combinations || [])) {
    let matchCount = 0;
    const matched = [];
    for (const pattern of emergencyCombo.symptom_patterns) {
      if (lower.includes(pattern.toLowerCase())) { matchCount++; matched.push(pattern); }
    }
    if (matchCount >= emergencyCombo.required_count) {
      return { type: emergencyCombo.id, name: emergencyCombo.name, message: emergencyCombo.message, action: emergencyCombo.action, severity: 'critical', detectionMethod: 'kb_combination', matchedPatterns: matched };
    }
  }

  return null;
}

function isUrgent(text) {
  if (!text || typeof text !== 'string') return false;
  const URGENT_PATTERNS = [
    /\bsevere\s*(pain|headache|dizziness|nausea)/i, /\bblood\s*in\s*(urine|stool|vomit)/i,
    /\bvomiting\s*blood/i, /\bcoughing\s*up\s*blood/i,
    /\bhigh\s*fever\s*(above|over|more\s*than)?\s*3[89]/i, /\bfever\s*(above|over|more\s*than)?\s*40/i,
    /\bvery\s*(high|low)\s*blood\s*pressure/i, /\bsevere\s*allergic/i,
    /\brapid\s*heart\s*rate/i, /\bpalpitations\s*(with|and)\s*(chest|pain|breath)/i,
  ];
  return URGENT_PATTERNS.some(p => p.test(text));
}

module.exports = { detect, isUrgent };
