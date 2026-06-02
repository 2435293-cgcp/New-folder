'use strict';
const matcher = require('./symptom_matcher');
const detector = require('./emergency_detector');
const kb = require('../data/medical_kb.json');

const ASH_PERSONALITY = {
  intros: [
    "I understand. Let me help you with that. 💙",
    "Thank you for sharing that with me. 💙",
    "I hear you. Let's look into this together. 💙",
    "I'm here for you. Let me share what I know about this. 💙",
    "That sounds uncomfortable — let's work through this together. 💙",
  ],
  noMatch: "I want to help, but I need a bit more information about what you're experiencing. Could you describe your symptoms in more detail? For example, where exactly is the pain, when did it start, and how severe is it on a scale of 1 to 10?",
  disclaimer: "\n\n*I'm Ash, an AI healthcare assistant. The information I provide is for general guidance only and is not a substitute for professional medical advice, diagnosis, or treatment. Please see a qualified doctor for proper evaluation. 💙*",
  seekCare: "Please don't hesitate to see a doctor if your symptoms are severe, worsening, or worrying you.",
};

function pickIntro(text) {
  const idx = (text.length + text.charCodeAt(0)) % ASH_PERSONALITY.intros.length;
  return ASH_PERSONALITY.intros[idx];
}

function formatList(items, limit) {
  const capped = limit ? items.slice(0, limit) : items;
  return capped.map(item => `• ${item}`).join('\n');
}

function buildEmergencyBlock(emergency) {
  return [
    `🚨 **URGENT ALERT — ${emergency.name}**`,
    '',
    emergency.message,
    '',
    `**What to do now:** ${emergency.action}`,
  ].join('\n');
}

function buildCategorySection(match, isPrimary) {
  const cat = match.category;
  if (!cat) return '';
  const lines = [];

  if (isPrimary) {
    lines.push(`**${cat.icon || ''} ${cat.name}** (${match.confidence}% match)`);
    lines.push('');
    lines.push(cat.description || '');
    lines.push('');
    if (cat.common_causes && cat.common_causes.length > 0) {
      lines.push('**Common causes:**');
      lines.push(formatList(cat.common_causes, 5));
      lines.push('');
    }
    if (cat.home_care && cat.home_care.length > 0) {
      lines.push('**What you can do at home:**');
      lines.push(formatList(cat.home_care, 5));
      lines.push('');
    }
    if (cat.warning_signs && cat.warning_signs.length > 0) {
      lines.push('**Warning signs — seek care urgently if you have:**');
      lines.push(formatList(cat.warning_signs, 4));
      lines.push('');
    }
  } else {
    lines.push(`**${cat.icon || ''} ${cat.name}** may also be relevant (${match.confidence}% match)`);
    if (cat.description) lines.push(cat.description.split('.')[0] + '.');
    if (cat.home_care && cat.home_care.length > 0) {
      lines.push('Key steps: ' + cat.home_care.slice(0, 2).join(' | '));
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildFollowUpQuestions(matches, extractedSymptoms) {
  const questions = new Set();
  if (matches.length > 0 && matches[0].category && matches[0].category.follow_up_questions) {
    for (const q of matches[0].category.follow_up_questions) questions.add(q);
  }
  if (matches.length > 1 && matches[1].category && matches[1].category.follow_up_questions) {
    questions.add(matches[1].category.follow_up_questions[0]);
  }

  const hasHandSymptom = extractedSymptoms.some(s => s.includes('hand') || s.includes('arm'));
  const hasSweating = extractedSymptoms.some(s => s.includes('sweat'));
  const hasCramps = extractedSymptoms.some(s => s.includes('cramp') || s.includes('spasm'));
  const hasChestSymptom = extractedSymptoms.some(s => s.includes('chest'));

  if (hasHandSymptom || hasSweating) {
    questions.add('Do you have any chest pain, tightness, or pressure?');
    questions.add('Are you feeling short of breath or dizzy?');
  }
  if (hasCramps) {
    questions.add('How much water have you had today?');
    questions.add('Have you been exercising, sweating heavily, or in hot weather recently?');
  }
  if (hasSweating && !hasChestSymptom) {
    questions.add('How long have you been experiencing these symptoms?');
  }
  return Array.from(questions).slice(0, 4);
}

function buildSpecialCombinationResponse(extractedSymptoms, matches, text) {
  const lower = text.toLowerCase();
  const hasLeftHand = lower.includes('left hand') || lower.includes('left arm') ||
    extractedSymptoms.some(s => s === 'left hand pain');
  const hasSweating = lower.includes('sweat') || extractedSymptoms.some(s => s.includes('sweat'));
  const hasCramps = lower.includes('cramp') || lower.includes('spasm') ||
    extractedSymptoms.some(s => s.includes('cramp') || s.includes('spasm'));
  const hasDehydration = lower.includes('thirst') || lower.includes('dehydrat') ||
    extractedSymptoms.some(s => s.includes('thirst') || s.includes('dehydrat'));

  if (hasLeftHand && hasSweating && hasCramps) return buildLeftHandSweatCrampsResponse(extractedSymptoms);
  if (hasLeftHand && hasSweating) return buildLeftHandSweatResponse(extractedSymptoms);
  if (hasCramps && (hasDehydration || hasSweating)) return buildCrampsDehydrationResponse(extractedSymptoms);
  return null;
}

function buildLeftHandSweatCrampsResponse(extractedSymptoms) {
  const lines = [
    ASH_PERSONALITY.intros[2], '',
    "You've mentioned left hand pain, sweating, and cramps together. This is a combination I take seriously.", '',
    '⚠️ **Important — Please Read First**', '',
    'Left hand pain combined with sweating can occasionally be an early warning sign of cardiac problems. While the most common cause is muscle strain or dehydration, if you also have **chest pain, chest tightness, jaw pain, or feel very unwell**, seek emergency care immediately.', '',
    '💪 **Most Likely: Muscle Cramps from Dehydration or Electrolyte Imbalance**', '',
    'The combination of hand cramps, sweating, and general muscle cramping is very commonly caused by:', '',
    '• **Dehydration** — sweating causes fluid loss, and when not replaced, muscles cramp especially in the hands.',
    '• **Electrolyte imbalance** — sweating depletes potassium, magnesium, calcium, and sodium, essential for muscle function.',
    '• **Muscle overuse or strain** — repetitive hand use or gripping, especially when dehydrated.',
    '• **Poor circulation** — if the hand feels cold, numb, or tingly alongside the cramp.',
    '• **Nerve compression** — pressure on nerves in the wrist (carpal tunnel) or neck can cause cramping.', '',
    '**What to do right now:**', '',
    '• Drink water or an electrolyte drink (sports drink, coconut water) right away',
    '• Gently stretch and flex your hand and fingers — open and close them slowly',
    '• Apply a warm compress or run warm water over the affected hand',
    '• Eat a banana, handful of nuts, or leafy greens to restore potassium and magnesium',
    '• Rest the hand and avoid gripping or repetitive movements for now', '',
    '**To help me give you better guidance:**', '',
    '1. Do you have any chest pain, chest tightness, or pain in your jaw or shoulder?',
    '2. Are you short of breath, or feeling dizzy or faint?',
    '3. How long have the cramps and sweating been going on?',
    '4. Have you been exercising, working in the heat, or not drinking much water today?', '',
    '**When to seek urgent care:**',
    "If you have chest pain, shortness of breath, or the left hand pain is severe and spreading up your arm — please seek medical care urgently. It's always better to be checked.",
  ];
  return lines.join('\n');
}

function buildLeftHandSweatResponse(extractedSymptoms) {
  const lines = [
    ASH_PERSONALITY.intros[0], '',
    'Left hand pain combined with sweating is something I want to address carefully.', '',
    '⚠️ **Cardiac Warning — Please Assess These Symptoms**', '',
    'While left hand pain alone is often caused by muscle strain or nerve compression, the combination with **sweating** can sometimes be an early sign of a cardiac event — particularly with chest discomfort, jaw pain, nausea, or shortness of breath.', '',
    '**Please check yourself right now:**',
    '• Do you have chest pain, pressure, or tightness?',
    '• Is the pain spreading to your left arm, shoulder, jaw, or back?',
    '• Are you feeling sick, sweating heavily, or dizzy?', '',
    'If YES to any of these: **call emergency services (911/112/999) immediately.**', '',
    '**If you have no chest symptoms** — the cause is more likely:',
    '• Dehydration causing muscle cramps (sweating depletes electrolytes)',
    '• Muscle strain or overuse of the hand',
    '• Poor circulation, especially if the hand feels cold or numb',
    '• Nerve compression at the wrist or neck', '',
    '**Home care:** Drink water, gently stretch the hand, apply warmth, and rest.',
  ];
  return lines.join('\n');
}

function buildCrampsDehydrationResponse(extractedSymptoms) {
  const lines = [
    ASH_PERSONALITY.intros[1], '',
    "It sounds like you're dealing with muscle cramps, possibly linked to dehydration or electrolyte loss — a very common and treatable combination.", '',
    '💪 **Muscle Cramps and Dehydration**', '',
    "When your body loses fluids — through sweating, illness, or not drinking enough — it also loses essential minerals (potassium, magnesium, sodium, calcium). Without these, muscles cramp and spasm.", '',
    '**What you can do right now:**', '',
    '• Drink water or an electrolyte drink immediately',
    '• Eat potassium-rich foods: banana, avocado, potato',
    '• Eat magnesium-rich foods: dark chocolate, nuts, seeds, leafy greens',
    '• Gently stretch and massage the cramping muscle',
    '• Apply a warm compress to relax the muscle',
    "• Rest and avoid further strenuous activity until you've rehydrated", '',
    '**Questions to consider:**',
    '1. How much water have you had today?',
    '2. Have you been sweating heavily, vomiting, or had diarrhea?',
    '3. Are the cramps in your hands, legs, or both?',
  ];
  return lines.join('\n');
}

function buildGenericResponse(text, matches, extractedSymptoms) {
  if (!matches || matches.length === 0) {
    return [pickIntro(text), '', ASH_PERSONALITY.noMatch].join('\n');
  }

  const lines = [pickIntro(text), ''];
  const primaryMatch = matches[0];

  if (extractedSymptoms.length > 0) {
    const symptomsDisplay = extractedSymptoms.slice(0, 5).join(', ');
    lines.push(`Based on what you've shared, I can see you may be experiencing: **${symptomsDisplay}**. Let me walk you through what this could mean.`);
    lines.push('');
  }

  lines.push(buildCategorySection(primaryMatch, true));

  if (matches.length > 1) {
    const secondary = matches[1];
    if (secondary.categoryId !== primaryMatch.categoryId) {
      lines.push('---'); lines.push('');
      lines.push(buildCategorySection(secondary, false));
    }
  }

  if (primaryMatch.category && primaryMatch.category.when_to_see_doctor) {
    lines.push('**When to see a doctor:**');
    lines.push(primaryMatch.category.when_to_see_doctor);
    lines.push('');
  }

  const followUps = buildFollowUpQuestions(matches, extractedSymptoms);
  if (followUps.length > 0) {
    lines.push('**To help me give you better guidance:**');
    followUps.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
    lines.push('');
  }

  return lines.join('\n');
}

function buildResponse(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return {
      reply: "I'm here to help. Could you tell me more about how you're feeling? 💙" + ASH_PERSONALITY.disclaimer,
      source: 'local', emergency: null, matches: [], confidence: 0, extractedSymptoms: [], sources: [],
    };
  }

  const emergency = detector.detect(text);
  const { matches, extractedSymptoms } = matcher.match(text);

  let responseBody = '';

  if (emergency) {
    responseBody = buildEmergencyBlock(emergency);
    if (matches.length > 0) {
      const specialResponse = buildSpecialCombinationResponse(extractedSymptoms, matches, text);
      if (specialResponse) {
        responseBody += '\n\n---\n\n' + specialResponse;
      } else if (matches[0].category) {
        responseBody += '\n\n---\n\n**Additional context about your symptoms:**\n\n';
        responseBody += buildCategorySection(matches[0], false);
      }
    }
  } else {
    const specialResponse = buildSpecialCombinationResponse(extractedSymptoms, matches, text);
    responseBody = specialResponse || buildGenericResponse(text, matches, extractedSymptoms);
  }

  if (!emergency && detector.isUrgent(text)) {
    responseBody += '\n\n' + ASH_PERSONALITY.seekCare;
  }

  const reply = responseBody + ASH_PERSONALITY.disclaimer;
  const sources = matches.map(m => m.category ? m.category.name : m.categoryId);
  const confidence = matches.length > 0 ? matches[0].confidence : 0;

  return {
    reply, source: 'local', emergency, matches, confidence, extractedSymptoms, sources,
  };
}

module.exports = { buildResponse };
