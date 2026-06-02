# MediCare AI Agent

A professional medical and pharmaceutical AI assistant powered by Google Gemini. Built with plain HTML, CSS, and JavaScript — no frameworks, no build step.

---

## Features

- Medical guidance: symptoms, conditions, first-aid, and lifestyle tips
- Pharmaceutical info: dosage, side effects, drug interactions, storage
- Editable system prompt per organization
- Multi-turn chat with conversation history
- Settings auto-filled from `.env` — no manual key entry
- Zero npm dependencies

---

## Project Structure

```
├── medicare_agent.html   # Full UI (HTML + CSS + JS)
├── server.js             # Node.js server — reads .env, injects values
├── package.json
├── .env                  # Your secrets (never commit this)
├── .gitignore
└── test_medicare_agent.py  # pytest test suite for the agent logic
```

---

## Prerequisites

- [Node.js](https://nodejs.org/) v14 or higher
- A Gemini API key → get one free at [Google AI Studio](https://aistudio.google.com/app/apikey)

---

## Getting Started

### 1. Clone or download the project

```bash
git clone <your-repo-url>
cd medicare-ai-agent
```

### 2. Configure your `.env`

Open `.env` and replace the placeholder with your real values:

```env
GEMINI_API_KEY=your_gemini_api_key_here
ORG_NAME=MediCare Organization
PORT=3000
```

### 3. Start the server

```bash
node server.js
```

### 4. Open in browser

```
http://localhost:3000
```

The settings panel will be pre-filled with your `.env` values. Click **Save & Activate Agent** and start chatting.

---

## Running Tests

Requires Python 3 and pytest:

```bash
pip install pytest
pytest test_medicare_agent.py -v
```

Test coverage includes agent initialization, activation, chat responses, system prompt updates, and the full save-and-activate workflow.

---

## Environment Variables

| Variable          | Required | Description                        |
|-------------------|----------|------------------------------------|
| `GEMINI_API_KEY`  | Yes      | Your Google Gemini API key         |
| `ORG_NAME`        | No       | Organization name shown in the UI  |
| `PORT`            | No       | Server port (default: `3000`)      |

---

## Usage Notes

- This tool provides **general medical and pharmaceutical information only** — not a substitute for professional medical advice.
- Always consult a doctor or pharmacist before starting, stopping, or changing any medication.
- The `.env` file contains sensitive credentials — it is excluded from git via `.gitignore`.

---

## Tech Stack

| Layer     | Technology                  |
|-----------|-----------------------------|
| UI        | HTML5, CSS3, Vanilla JS     |
| AI Model  | Google Gemini 2.0 Flash     |
| Server    | Node.js (built-in `http`)   |
| Tests     | Python pytest               |
