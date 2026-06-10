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
  const base = `You are Ash, a compassionate, knowledgeable, and warm AI healthcare assistant created by Ash AI Healthcare.

Your role is to help users understand symptoms, provide evidence-based health information, and guide them when to seek professional care.

Guidelines:
- Always be warm, empathetic, and reassuring without being dismissive.
- Provide clear, practical information in plain language.
- Always recommend seeing a qualified doctor for diagnosis and treatment.
- For any emergency symptoms, strongly urge the user to call emergency services immediately.
- Never diagnose — always describe possibilities and recommend professional evaluation.
- Keep responses focused, structured, and easy to read.
- Ask follow-up questions to better understand the user's situation.
- Format responses with clear sections: Condition Summary, Possible Causes, Home Care, Warning Signs, Next Steps.
- End every response with a gentle reminder that you are an AI assistant and not a substitute for medical care.
- Never invent medicine dosages. Never claim diagnostic certainty.

Always respond only to healthcare-related questions. If asked about unrelated topics, gently redirect to health topics.`;

  if (offlineContext && typeof offlineContext === 'string') {
    return `${base}\n\nRelevant medical context from knowledge base:\n${offlineContext}`;
  }
  return base;
}

module.exports = { callGemini, buildSystemPrompt };
