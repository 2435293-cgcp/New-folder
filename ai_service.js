'use strict';
const https = require('https');

// ---------------------------------------------------------------------------
// Gemini API configuration
// ---------------------------------------------------------------------------
const GEMINI_API_HOST = 'generativelanguage.googleapis.com';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_VERSION = 'v1beta';
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_OUTPUT_TOKENS = 1024;

// ---------------------------------------------------------------------------
// buildRequestBody — constructs the Gemini API request payload.
// history is an array of { role: 'user'|'model', text: string }
// systemPrompt is prepended as a 'system' instruction.
// ---------------------------------------------------------------------------
function buildRequestBody(systemPrompt, history) {
  const contents = [];

  // Convert history to Gemini 'contents' format
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

  // If history is empty, add a placeholder user message to avoid API errors
  if (contents.length === 0) {
    contents.push({
      role: 'user',
      parts: [{ text: 'Hello' }],
    });
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
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_ONLY_HIGH',
      },
    ],
  };

  // Add system instruction if provided
  if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.trim().length > 0) {
    body.systemInstruction = {
      parts: [{ text: systemPrompt.trim() }],
    };
  }

  return JSON.stringify(body);
}

// ---------------------------------------------------------------------------
// parseGeminiResponse — extracts the text reply from a Gemini API response.
// ---------------------------------------------------------------------------
function parseGeminiResponse(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    throw new Error(`Failed to parse Gemini response JSON: ${err.message}`);
  }

  // Handle API-level errors
  if (parsed.error) {
    const errMsg = parsed.error.message || JSON.stringify(parsed.error);
    throw new Error(`Gemini API error: ${errMsg}`);
  }

  // Extract text from candidates
  const candidates = parsed.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('Gemini returned no candidates in the response.');
  }

  const firstCandidate = candidates[0];

  // Check finish reason
  if (firstCandidate.finishReason && firstCandidate.finishReason === 'SAFETY') {
    throw new Error('Gemini blocked the response due to safety filters.');
  }

  const content = firstCandidate.content;
  if (!content || !Array.isArray(content.parts) || content.parts.length === 0) {
    throw new Error('Gemini response candidate has no content parts.');
  }

  const text = content.parts.map(p => p.text || '').join('');
  if (!text.trim()) {
    throw new Error('Gemini returned an empty text response.');
  }

  return text.trim();
}

// ---------------------------------------------------------------------------
// callGemini — makes an HTTPS POST to the Gemini 2.0 Flash API.
//
// Parameters:
//   apiKey      {string}  Your Gemini API key
//   systemPrompt {string} System-level instruction for Ash's persona/behaviour
//   history     {Array}   Conversation history: [{ role, text }, ...]
//
// Returns: Promise<string> — the model's text reply
// ---------------------------------------------------------------------------
function callGemini(apiKey, systemPrompt, history) {
  return new Promise((resolve, reject) => {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return reject(new Error('callGemini: a valid API key is required.'));
    }

    const requestBody = buildRequestBody(systemPrompt, history);
    const path = `/${GEMINI_API_VERSION}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

    const options = {
      hostname: GEMINI_API_HOST,
      path,
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

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (timedOut) return;

        if (res.statusCode && res.statusCode >= 400) {
          let errBody = responseData;
          try {
            const parsed = JSON.parse(responseData);
            errBody = (parsed.error && parsed.error.message) || responseData;
          } catch (_) {}
          return reject(new Error(`Gemini API HTTP ${res.statusCode}: ${errBody}`));
        }

        try {
          const reply = parseGeminiResponse(responseData);
          resolve(reply);
        } catch (parseErr) {
          reject(parseErr);
        }
      });
    });

    // Timeout handler
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

    req.on('close', () => {
      clearTimeout(timeoutHandle);
    });

    req.write(requestBody, 'utf8');
    req.end();
  });
}

// ---------------------------------------------------------------------------
// buildSystemPrompt — helper to construct Ash's system prompt.
// Can be used by server.js or any caller of callGemini.
// ---------------------------------------------------------------------------
function buildSystemPrompt(offlineContext) {
  const base = `You are Ash, a compassionate, knowledgeable, and warm medical AI assistant.
Your role is to help users understand their symptoms, provide evidence-based health information,
and guide them on when to seek professional care.

Guidelines:
- Always be warm, empathetic, and reassuring without being dismissive.
- Provide clear, practical information in plain language.
- Always recommend seeing a qualified doctor for diagnosis and treatment.
- For any emergency symptoms, strongly urge the user to call emergency services immediately.
- Never diagnose — always describe possibilities and recommend professional evaluation.
- Keep responses focused, structured, and easy to read.
- End every response with a gentle reminder that you are an AI assistant and not a substitute for medical care.`;

  if (offlineContext && typeof offlineContext === 'string') {
    return `${base}\n\nRelevant medical context from knowledge base:\n${offlineContext}`;
  }

  return base;
}

module.exports = { callGemini, buildSystemPrompt };
