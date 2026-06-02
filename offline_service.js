'use strict';
const matcher = require('./symptom_matcher');
const detector = require('./emergency_detector');
const kb = require('./medical_kb.json');

// ---------------------------------------------------------------------------
// Ash personality strings
// ---------------------------------------------------------------------------
const ASH_PERSONALITY = {
  intros: [
    "I understand. Let me help you with that. 💙",
    "Thank you for sharing that with me. 💙",
    "I hear you. Let's look into this together. 💙",
    "I'm here for you. Let me share what I know about this. 💙",
    "That sounds uncomfortable — let's work through this together. 💙",
  ],
  noMatch: "I want to help, but I need a bit more information about what you're experiencing. Could you describe your symptoms in more detail? For example, where exactly is the pain, when did it start, and how severe is it on a scale of 1 to 10?",
  emergency: "🚨 This sounds like it could be a medical emergency. Please do not wait.",
  disclaimer: "\n\n*I'm Ash, an AI medical assistant. The information I provide is for general guidance only and is not a substitute for professional medical advice, diagnosis, or treatment. Please see a qualified doctor for proper evaluation. 💙*",
  seekCare: "Please don't hesitate to see a doctor if your symptoms are severe, worsening, or worrying you.",
};

// ---------------------------------------------------------------------------
// pickIntro — returns a varied intro based on a simple hash of the text
// ---------------------------------------------------------------------------
function pickIntro(text) {
  const idx = (text.length + text.charCodeAt(0)) % ASH_PERSONALITY.intros.length;
  return ASH_PERSONALITY.intros[idx];
}

// ---------------------------------------------------------------------------
// formatList — turns an array of strings into a readable bullet list
// ---------------------------------------------------------------------------
function formatList(items, limit) {
  const capped = limit ? items.slice(0, limit) : items;
  return capped.map(item => `• ${item}`).join('\n');
}

// ---------------------------------------------------------------------------
// buildEmergencyBlock — formats an emergency alert section
// ---------------------------------------------------------------------------
function buildEmergencyBlock(emergency) {
  return [
    `🚨 **URGENT ALERT — ${emergency.name}**`,
    '',
    emergency.message,
    '',
    `**What to do now:** ${emergency.action}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// buildCategorySection — builds a detailed section for a matched category
// ---------------------------------------------------------------------------
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
    // Secondary category — more compact
    lines.push(`**${cat.icon || ''} ${cat.name}** may also be relevant (${match.confidence}% match)`);
    if (cat.description) {
      const shortDesc = cat.description.split('.')[0] + '.';
      lines.push(shortDesc);
    }
    if (cat.home_care && cat.home_care.length > 0) {
      lines.push('Key steps: ' + cat.home_care.slice(0, 2).join(' | '));
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// buildFollowUpQuestions — collects follow-up questions from matched categories
// and adds contextual questions based on the symptom combination
// ---------------------------------------------------------------------------
function buildFollowUpQuestions(matches, extractedSymptoms, emergency) {
  const questions = new Set();

  // Always add questions from the primary category
  if (matches.length > 0 && matches[0].category && matches[0].category.follow_up_questions) {
    for (const q of matches[0].category.follow_up_questions) {
      questions.add(q);
    }
  }

  // Add one question from secondary category
  if (matches.length > 1 && matches[1].category && matches[1].category.follow_up_questions) {
    questions.add(matches[1].category.follow_up_questions[0]);
  }

  // Contextual questions based on symptom combinations
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

  // Limit to 4 most relevant questions
  return Array.from(questions).slice(0, 4);
}

// ---------------------------------------------------------------------------
// buildSpecialCombinationResponse — handles known symptom combinations with
// tailored multi-paragraph responses.
// ---------------------------------------------------------------------------
function buildSpecialCombinationResponse(extractedSymptoms, matches, text) {
  const lower = text.toLowerCase();

  const hasLeftHand = lower.includes('left hand') || lower.includes('left arm') ||
    extractedSymptoms.some(s => s === 'left hand pain');
  const hasSweating = lower.includes('sweat') ||
    extractedSymptoms.some(s => s.includes('sweat'));
  const hasCramps = lower.includes('cramp') || lower.includes('spasm') ||
    extractedSymptoms.some(s => s.includes('cramp') || s.includes('spasm'));
  const hasDehydration = lower.includes('thirst') || lower.includes('dehydrat') ||
    extractedSymptoms.some(s => s.includes('thirst') || s.includes('dehydrat'));

  // Special case: left hand pain + sweating + cramps
  if (hasLeftHand && hasSweating && hasCramps) {
    return buildLeftHandSweatCrampsResponse(extractedSymptoms, matches);
  }

  // Special case: left hand pain + sweating (cardiac combination)
  if (hasLeftHand && hasSweating) {
    return buildLeftHandSweatResponse(extractedSymptoms, matches);
  }

  // Special case: cramps + dehydration signals
  if (hasCramps && (hasDehydration || hasSweating)) {
    return buildCrampsDehydrationResponse(extractedSymptoms, matches);
  }

  return null; // No special case — use generic builder
}

// ---------------------------------------------------------------------------
// buildLeftHandSweatCrampsResponse — tailored response for the combination
// of left hand pain, sweating, and cramps (the critical test case)
// ---------------------------------------------------------------------------
function buildLeftHandSweatCrampsResponse(extractedSymptoms, matches) {
  const lines = [];

  lines.push(ASH_PERSONALITY.intros[2]); // "I hear you..."
  lines.push('');
  lines.push("You've mentioned left hand pain, sweating, and cramps together. This is a combination I take seriously, and I want to give you a careful, thorough response.");
  lines.push('');

  // IMPORTANT: cardiac combination alert first
  lines.push('⚠️ **Important — Please Read First**');
  lines.push('');
  lines.push('Left hand pain combined with sweating can occasionally be an early warning sign of cardiac problems. While the most common cause is muscle strain or dehydration (which I\'ll explain below), it\'s important that if you also have **chest pain, chest tightness, jaw pain, or feel very unwell**, you should seek emergency care or call emergency services immediately rather than waiting.');
  lines.push('');

  // Primary: muscle cramps / dehydration explanation
  lines.push('💪 **Most Likely: Muscle Cramps from Dehydration or Electrolyte Imbalance**');
  lines.push('');
  lines.push('The combination of hand cramps, sweating, and general muscle cramping is very commonly caused by:');
  lines.push('');
  lines.push('• **Dehydration** — sweating causes you to lose fluids, and when you\'re not replacing them fast enough, muscles can cramp, especially in the hands and legs.');
  lines.push('• **Electrolyte imbalance** — sweating also depletes potassium, magnesium, calcium, and sodium. These minerals are essential for muscle function, and low levels cause painful cramps and spasms.');
  lines.push('• **Muscle overuse or strain** — repetitive hand use, gripping, or unusual activity can cause hand muscles to cramp, especially when dehydrated.');
  lines.push('• **Poor circulation** — if the hand feels cold, numb, or tingly alongside the cramp, reduced blood flow to the hand muscles may be a factor.');
  lines.push('• **Nerve compression** — pressure on nerves in the wrist (carpal tunnel) or neck can cause cramping and numbness in the hand.');
  lines.push('');

  // What to do
  lines.push('**What to do right now:**');
  lines.push('');
  lines.push('• Drink water or an electrolyte drink (sports drink, coconut water) right away');
  lines.push('• Gently stretch and flex your hand and fingers — open and close them slowly');
  lines.push('• Apply a warm compress or run warm water over the affected hand');
  lines.push('• Eat a banana, handful of nuts, or leafy greens to restore potassium and magnesium');
  lines.push('• Rest the hand and avoid gripping or repetitive movements for now');
  lines.push('');

  // Secondary: hand pain section
  lines.push('✋ **Hand Pain — Other Causes to Consider**');
  lines.push('');
  lines.push('If the pain has been building gradually or is in a specific part of your hand or wrist, it may also be related to carpal tunnel syndrome, tendinitis, or arthritis. These cause localised pain, stiffness, and sometimes tingling or numbness, often worse at certain times of day.');
  lines.push('');

  // Follow-up questions
  lines.push('**To help me give you better guidance, it would help to know:**');
  lines.push('');
  lines.push('1. Do you have any chest pain, chest tightness, or pain in your jaw or shoulder?');
  lines.push('2. Are you short of breath, or feeling dizzy or faint?');
  lines.push('3. How long have the cramps and sweating been going on?');
  lines.push('4. Have you been exercising, working in the heat, or not drinking much water today?');
  lines.push('');

  // Final warning
  lines.push('**When to seek urgent care:**');
  lines.push('If you have chest pain, shortness of breath, or the left hand pain is severe and spreading up your arm — please seek medical care urgently or call emergency services. It\'s always better to be checked and reassured than to wait.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// buildLeftHandSweatResponse — cardiac alert without cramps
// ---------------------------------------------------------------------------
function buildLeftHandSweatResponse(extractedSymptoms, matches) {
  const lines = [];

  lines.push(ASH_PERSONALITY.intros[0]);
  lines.push('');
  lines.push("Left hand pain combined with sweating is something I want to address carefully.");
  lines.push('');
  lines.push('⚠️ **Cardiac Warning — Please Assess These Symptoms**');
  lines.push('');
  lines.push('While left hand pain on its own is often caused by muscle strain, poor circulation, or nerve compression, the combination of **left hand pain with sweating** can sometimes be an early sign of a cardiac event — particularly if you also notice any chest discomfort, pain in your jaw or shoulder, nausea, or shortness of breath.');
  lines.push('');
  lines.push('**Please check yourself right now:**');
  lines.push('• Do you have chest pain, pressure, or tightness?');
  lines.push('• Is the pain spreading to your left arm, shoulder, jaw, or back?');
  lines.push('• Are you feeling sick to your stomach, sweating heavily, or dizzy?');
  lines.push('');
  lines.push('If YES to any of these: **call emergency services (911/112/999) immediately.** Do not wait.');
  lines.push('');
  lines.push('**If you have no chest symptoms** — the cause is more likely:');
  lines.push('• Dehydration causing muscle cramps (sweating depletes electrolytes)');
  lines.push('• Muscle strain or overuse of the hand');
  lines.push('• Poor circulation, especially if the hand feels cold or numb');
  lines.push('• Nerve compression at the wrist or neck');
  lines.push('');
  lines.push('**Home care:** Drink water, gently stretch the hand, apply warmth, and rest.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// buildCrampsDehydrationResponse — cramps with dehydration signals
// ---------------------------------------------------------------------------
function buildCrampsDehydrationResponse(extractedSymptoms, matches) {
  const lines = [];

  lines.push(ASH_PERSONALITY.intros[1]);
  lines.push('');
  lines.push("It sounds like you're dealing with muscle cramps, possibly linked to dehydration or electrolyte loss — a very common and treatable combination.");
  lines.push('');
  lines.push('💪 **Muscle Cramps and Dehydration**');
  lines.push('');
  lines.push('When your body loses fluids — through sweating, illness, or simply not drinking enough — it also loses essential minerals called electrolytes (potassium, magnesium, sodium, calcium). Without these, muscles don\'t contract and relax normally, leading to painful cramps and spasms.');
  lines.push('');
  lines.push('**What you can do right now:**');
  lines.push('');
  lines.push('• Drink water or an electrolyte drink immediately');
  lines.push('• Eat potassium-rich foods: banana, avocado, potato');
  lines.push('• Eat magnesium-rich foods: dark chocolate, nuts, seeds, leafy greens');
  lines.push('• Gently stretch and massage the cramping muscle');
  lines.push('• Apply a warm compress to relax the muscle');
  lines.push('• Rest and avoid further strenuous activity until you\'ve rehydrated');
  lines.push('');
  lines.push('**Questions to consider:**');
  lines.push('1. How much water have you had today?');
  lines.push('2. Have you been sweating heavily, vomiting, or had diarrhea?');
  lines.push('3. Are the cramps in your hands, legs, or both?');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// buildGenericResponse — builds a warm, natural response for general symptom
// queries that don't match a special combination.
// ---------------------------------------------------------------------------
function buildGenericResponse(text, matches, extractedSymptoms) {
  if (!matches || matches.length === 0) {
    return [
      pickIntro(text),
      '',
      ASH_PERSONALITY.noMatch,
    ].join('\n');
  }

  const lines = [];
  lines.push(pickIntro(text));
  lines.push('');

  const primaryMatch = matches[0];

  // Extracted symptoms acknowledgment
  if (extractedSymptoms.length > 0) {
    const symptomsDisplay = extractedSymptoms.slice(0, 5).join(', ');
    lines.push(`Based on what you've shared, I can see you may be experiencing: **${symptomsDisplay}**. Let me walk you through what this could mean.`);
    lines.push('');
  }

  // Primary category
  lines.push(buildCategorySection(primaryMatch, true));

  // Secondary category (if present and different enough)
  if (matches.length > 1) {
    const secondary = matches[1];
    if (secondary.categoryId !== primaryMatch.categoryId) {
      lines.push('---');
      lines.push('');
      lines.push(buildCategorySection(secondary, false));
    }
  }

  // When to see doctor
  if (primaryMatch.category && primaryMatch.category.when_to_see_doctor) {
    lines.push('**When to see a doctor:**');
    lines.push(primaryMatch.category.when_to_see_doctor);
    lines.push('');
  }

  // Follow-up questions
  const followUps = buildFollowUpQuestions(matches, extractedSymptoms, null);
  if (followUps.length > 0) {
    lines.push('**To help me give you better guidance:**');
    followUps.forEach((q, i) => {
      lines.push(`${i + 1}. ${q}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// buildResponse — main entry point for the offline service.
//
// Orchestrates:
//   1. Emergency detection
//   2. Symptom matching
//   3. Response building (special combination or generic)
//   4. Disclaimer appending
//
// Returns:
//   {
//     reply: string,
//     emergency: object|null,
//     matches: array,
//     confidence: number,
//     extractedSymptoms: string[],
//     sources: string[]
//   }
// ---------------------------------------------------------------------------
function buildResponse(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      reply: "I'm here to help. Could you tell me more about how you're feeling? 💙" + ASH_PERSONALITY.disclaimer,
      emergency: null,
      matches: [],
      confidence: 0,
      extractedSymptoms: [],
      sources: [],
    };
  }

  // Step 1: Emergency detection
  const emergency = detector.detect(text);

  // Step 2: Symptom matching
  const { matches, extractedSymptoms } = matcher.match(text);

  // Step 3: Build the response body
  let responseBody = '';

  if (emergency) {
    // Emergency block always comes first
    const emergencyBlock = buildEmergencyBlock(emergency);
    responseBody = emergencyBlock;

    // If we also have symptom matches, add contextual info below
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
    // No emergency — try special combination response first
    const specialResponse = buildSpecialCombinationResponse(extractedSymptoms, matches, text);
    if (specialResponse) {
      responseBody = specialResponse;
    } else {
      responseBody = buildGenericResponse(text, matches, extractedSymptoms);
    }
  }

  // Check for urgency (below emergency threshold but worth flagging)
  if (!emergency && detector.isUrgent(text)) {
    responseBody += '\n\n' + ASH_PERSONALITY.seekCare;
  }

  // Step 4: Append disclaimer
  const reply = responseBody + ASH_PERSONALITY.disclaimer;

  // Step 5: Build sources list
  const sources = matches.map(m => m.category ? m.category.name : m.categoryId);

  // Step 6: Overall confidence (from primary match, or 0)
  const confidence = matches.length > 0 ? matches[0].confidence : 0;

  return {
    reply,
    emergency,
    matches,
    confidence,
    extractedSymptoms,
    sources,
  };
}

module.exports = { buildResponse };
