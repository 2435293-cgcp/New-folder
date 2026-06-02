'use strict';
const https = require('https');

const GEMINI_API_HOST = 'generativelanguage.googleapis.com';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_VERSION = 'v1beta';
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_OUTPUT_TOKENS = 1024;

function buildRequestBody(systemPrompt, history) {
  const contents = [];

  if (Array.isArray(history)) {
    for (const turn of history) {
      if (turn && turn.role && turn.text) {
        contents.push({
          role: turn.role === 'assistant' ? 'model' : turn.role,
          parts: [{ text: String(turn.text) }],
        });
      }
    }
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  const body = {
    contents,
    generationConfig: {
      temperature: 0.4,
      topK: 32,
      topP: 0.9,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      stopSequences: [],
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };

  if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.trim().length > 0) {
    body.systemInstruction = { parts: [{ text: systemPrompt.trim() }] };
  }

  return JSON.stringify(body);
}

function parseGeminiResponse(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    throw new Error(`Failed to parse Gemini response JSON: ${err.message}`);
  }

  if (parsed.error) {
    throw new Error(`Gemini API error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  }

  const candidates = parsed.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('Gemini returned no candidates.');
  }

  const first = candidates[0];
  if (first.finishReason === 'SAFETY') {
    throw new Error('Gemini blocked the response due to safety filters.');
  }

  const content = first.content;
  if (!content || !Array.isArray(content.parts) || content.parts.length === 0) {
    throw new Error('Gemini response has no content parts.');
  }

  const text = content.parts.map(p => p.text || '').join('');
  if (!text.trim()) throw new Error('Gemini returned an empty response.');

  return text.trim();
}

function callGemini(apiKey, systemPrompt, history) {
  return new Promise((resolve, reject) => {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return reject(new Error('callGemini: a valid API key is required.'));
    }

    const requestBody = buildRequestBody(systemPrompt, history);
    const reqPath = `/${GEMINI_API_VERSION}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

    const options = {
      hostname: GEMINI_API_HOST,
      path: reqPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody, 'utf8'),
      },
    };

    let responseData = '';
    let timedOut = false;

    const req = https.request(options, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        if (timedOut) return;
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = responseData;
          try {
            const p = JSON.parse(responseData);
            errBody = (p.error && p.error.message) || responseData;
          } catch (_) {}
          return reject(new Error(`Gemini API HTTP ${res.statusCode}: ${errBody}`));
        }
        try { resolve(parseGeminiResponse(responseData)); }
        catch (parseErr) { reject(parseErr); }
      });
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      req.destroy();
      reject(new Error(`Gemini API request timed out after ${DEFAULT_TIMEOUT_MS}ms.`));
    }, DEFAULT_TIMEOUT_MS);

    req.on('error', (err) => {
      if (timedOut) return;
      clearTimeout(timeoutHandle);
      reject(new Error(`Gemini API network error: ${err.message}`));
    });
    req.on('close', () => { clearTimeout(timeoutHandle); });

    req.write(requestBody, 'utf8');
    req.end();
  });
}

function buildSystemPrompt(offlineContext) {
  const base = `You are Ash, a friendly AI healthcare assistant.

* Answer only healthcare-related questions.
* Be warm, caring, and easy to understand.
* Never diagnose with certainty.
* Explain possible causes in simple language.
* Always tell the user what they can do next.
* Ask follow-up questions when needed.
* Recommend professional medical care when appropriate.
* For emergencies, advise immediate medical attention.
* Never invent medicine dosages or medical facts.

Response Format:

🩺 Summary
Brief explanation of the symptoms or concern.

🔍 Possible Causes
List common possible causes.

✅ What You Can Do
Provide safe, practical steps the user can take now.

⚠️ Warning Signs
Explain when urgent medical attention is needed.

➡️ Next Step
Suggest whether to monitor symptoms, visit a doctor, or seek emergency care.

End with:
"⚠️ I'm Ash, an AI healthcare assistant and not a substitute for professional medical care."`;

  if (offlineContext && typeof offlineContext === 'string') {
    return `${base}\n\nRelevant medical context from knowledge base:\n${offlineContext}`;
  }
  return base;
}

module.exports = { callGemini, buildSystemPrompt };
