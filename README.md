# Ash AI Healthcare Assistant

> **Smart Healthcare Guidance, Online or Offline.**

A production-ready AI healthcare assistant powered by Google Gemini with a full offline fallback. Ash answers healthcare questions accurately whether you have an internet connection or not — falling back to a local medical knowledge base of 13 categories and 25+ medicines when Gemini is unavailable.

---

## Features

- **Offline-first** — searches the local medical KB before calling Gemini; works even when the API key is exhausted or internet is down
- **Intelligent symptom matching** — Fuse.js fuzzy search with a custom stemmer, synonym map, and multi-word phrase detection
- **Emergency detection** — 8 emergency types (heart attack, stroke, seizure, anaphylaxis, etc.) with combination alert logic
- **Conversation memory** — node-cache keeps 30-minute sessions; remembers symptoms and context across messages
- **Persistent custom KB** — lowdb lets you train Ash with your own Q&A entries; stored in `data/knowledge.json`
- **Medicines database** — 25 common medicines searchable by name, generic name, or use case
- **Dark / Light mode** — smooth theme toggle in the header
- **Quick suggestion chips** — 10 health topic shortcuts on the home screen and input bar
- **Friendly personality** — warm, empathetic responses with structured sections: Condition Summary → Causes → Home Care → Warning Signs → Next Steps
- **Reliability rules** — never invents dosages, never claims diagnostic certainty, always shows disclaimer

---

## Project Structure

```
├── server.js                   # Express server — routes, lowdb, Gemini + offline logic
├── services/
│   ├── ai_service.js           # Gemini 2.0 Flash integration
│   ├── offline_service.js      # Offline response builder with personality
│   ├── symptom_matcher.js      # Fuse.js + stemmer + synonym map
│   └── emergency_detector.js  # 8 emergency pattern sets + combination alerts
├── data/
│   ├── medical_kb.json         # 13-category medical knowledge base
│   ├── medicines.json          # 25 common medicines with uses, warnings, dosage notes
│   └── knowledge.json          # Custom trained Q&A entries (auto-created by lowdb)
├── utils/
│   └── cache.js                # node-cache session management (30-min TTL)
├── public/
│   └── index.html              # Full UI — glassmorphism, dark/light mode, chips, avatars
├── .env                        # Your secrets (never commit this)
├── .env.example                # Template for environment variables
└── package.json
```

---

## Prerequisites

- [Node.js](https://nodejs.org/) v14 or higher
- A Gemini API key (optional — Ash works offline without one) → [Google AI Studio](https://aistudio.google.com/app/apikey)

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```env
GEMINI_API_KEY=your_gemini_api_key_here
AI_NAME=Ash
ORG_NAME=Ash AI Healthcare
PORT=3000
```

`GEMINI_API_KEY` is optional. If omitted, Ash runs fully offline using the local knowledge base.

### 3. Start the server

```bash
npm start
```

### 4. Open in browser

```
http://localhost:3000
```

---

## How It Works

```
User message
     │
     ▼
┌─────────────────────┐
│  Emergency detector  │  ← Checks for 8 critical emergencies first
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│   Gemini AI (online) │  ← Tried first if API key is configured
│   (Gemini 2.0 Flash) │
└─────────────────────┘
     │ (fails / no key)
     ▼
┌─────────────────────┐
│  Offline service     │  ← medical_kb.json via Fuse.js symptom matcher
│  (local KB)          │     🟢 Ash Offline Knowledge Base Active
└─────────────────────┘
     │ (low confidence)
     ▼
┌─────────────────────┐
│  Custom KB (lowdb)   │  ← User-trained Q&A entries via the Train tab
└─────────────────────┘
     │
     ▼
  Response with badge (Gemini AI / Offline / Emergency)
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/chat` | Main chat — Gemini → offline fallback |
| `GET`  | `/api/status` | Server status, mode, KB stats |
| `GET`  | `/api/knowledge` | List all custom KB entries |
| `POST` | `/api/train` | Add a custom Q&A entry |
| `DELETE` | `/api/train/:id` | Remove a custom Q&A entry |
| `GET`  | `/api/medicines?q=` | Search medicines database |
| `GET`  | `/api/search?q=` | Fuzzy search custom KB |
| `GET`  | `/api/test-offline?q=` | Smoke-test offline symptom matching |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | No | Google Gemini API key — omit for offline-only mode |
| `AI_NAME` | No | Assistant name (default: `Ash`) |
| `ORG_NAME` | No | Organization name shown in the UI (default: `Ash AI Healthcare`) |
| `PORT` | No | Server port (default: `3000`) |

---

## Medical Knowledge Base

Ash's offline KB covers 13 conditions:

| Category | Icon |
|----------|------|
| Fever | 🌡️ |
| Headache | 🤕 |
| Cold & Flu | 🤧 |
| Chest Pain | 💔 |
| Hand Pain | ✋ |
| Leg Pain | 🦵 |
| Stomach Pain | 🤢 |
| Diabetes | 🩸 |
| Blood Pressure / Hypertension | 🩺 |
| Dehydration | 💧 |
| Muscle Cramps | 💪 |
| First Aid | 🩹 |
| Emergency Conditions | 🚨 |

Each category includes: description, common causes, home care steps, warning signs, when to see a doctor, and follow-up questions.

---

## Emergency Detection

Ash detects and immediately alerts for:

- Heart Attack (chest pain, left arm pain, jaw pain + sweating combinations)
- Stroke (FAST — Face, Arm, Speech, Time)
- Breathing Emergency
- Severe Bleeding
- Loss of Consciousness
- Seizure / Convulsion
- Overdose / Poisoning
- Anaphylaxis (severe allergic reaction)

Emergency messages show as pulsing red alert cards with immediate action instructions.

---

## Training Ash

Use the **🧠 Train AI** tab in settings to add custom Q&A entries:

1. Enter a question / topic
2. Add comma-separated keywords for better matching
3. Select a category
4. Write the answer
5. Click **+ Add to Knowledge Base**

Entries are stored in `data/knowledge.json` via lowdb and searched with Fuse.js when neither Gemini nor the built-in medical KB produce a confident answer.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | HTML5, CSS3 (Glassmorphism), Vanilla JS |
| AI Model | Google Gemini 2.0 Flash |
| Server | Node.js + Express |
| Fuzzy Search | Fuse.js |
| Local DB | lowdb (JSON file, synchronous) |
| Session Cache | node-cache (30-min TTL) |
| Offline KB | Custom medical JSON + stemmer |

---

## Reliability Rules

- Never invents medicine dosages or specific treatment protocols
- Never claims diagnostic certainty — always says "could be" or "common causes include"
- Always shows a medical disclaimer on every response
- Recommends professional care for any serious or persistent symptoms
- Falls back to offline KB rather than giving an unrelated answer when Gemini fails

---

## Disclaimer

Ash provides **general health information only** — not medical advice, diagnosis, or treatment. Always consult a qualified healthcare professional for any medical concerns.
