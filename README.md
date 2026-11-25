# VoiceMate – AI Voice Assistant Website

Talk to an AI assistant in your browser. You speak, it answers out loud.
Built with **Python (Flask)**, plain **HTML/CSS/JavaScript**, and the **Claude AI API**.

## How it works

```
 You speak ──► browser speech recognition ──► text ──► Flask server ──► Claude AI
                                                                              │
 You hear  ◄── browser speech synthesis  ◄── reply text ◄─────────────────────┘
```

- **Listening and speaking** happen in the browser (Web Speech API), so no audio is uploaded to this server and no extra Python audio libraries are needed.
- **Thinking** happens on the server. Quick questions (time, date, simple maths, jokes) are answered instantly and exactly by built-in skills in `skills.py`; everything else goes to the Claude API.
- Your **API key stays on the server** and is never sent to the browser.

## Features

- Big mic button with live transcript while you talk
- Spoken replies, with a stop button (or say "stop", or press Esc)
- Remembers the recent conversation, so follow-up questions work
- Language, voice and speaking-speed settings (English, Hindi, Spanish, French, German)
- "Keep listening" mode for hands-free back-and-forth
- Type instead of talk whenever you like
- Works without an API key in offline mode (time, date, maths, jokes)
- Per-IP rate limit to protect your API budget

## Run it

```bash
pip install -r requirements.txt
cp .env.example .env          # then put your Anthropic API key inside
python app.py
```

Open http://127.0.0.1:5000 in **Chrome, Edge or Safari** and tap the microphone.

Get an API key at https://console.anthropic.com. Without one the site still runs in offline mode.

## Settings (environment variables or `.env`)

| Variable             | Default             | Meaning                                       |
|----------------------|---------------------|-----------------------------------------------|
| `ANTHROPIC_API_KEY`  | *(none)*            | Turns on AI answers                           |
| `ANTHROPIC_MODEL`    | `claude-sonnet-5-5` | Which Claude model to use                     |
| `RATE_LIMIT_PER_MIN` | `20`                | Max requests per IP per minute                |
| `PORT`               | `5000`              | Local port                                    |
| `TRUST_PROXY`        | off                 | Set to `1` behind a host proxy (e.g. Render)  |

## Project layout

```
voice-assistant/
├── app.py            # Flask server: /api/chat, /api/status
├── skills.py         # instant offline skills (time, date, maths, jokes)
├── templates/index.html
├── static/app.js     # speech recognition, speech synthesis, chat logic
├── static/style.css
├── requirements.txt
└── render.yaml       # optional one-click deploy to Render
```

## Good to know

- **Microphone access needs HTTPS** (or `localhost`). Hosts like Render provide HTTPS automatically.
- **Browser support:** voice input works in Chrome, Edge and Safari. Firefox has no speech recognition, so use the text box there.
- Chrome's speech recognition sends audio to Google's servers; that is a browser feature, not this app.
- **A public site spends your API credit.** Keep the rate limit low, or keep the deployment private. Never commit your `.env` file (it is already in `.gitignore`).
- The assistant can only talk. It cannot set alarms, make calls or open apps.

## Deploy on Render

1. Push this repo to GitHub.
2. In Render choose **New → Blueprint** and select the repo (it reads `render.yaml`).
3. When asked, paste your `ANTHROPIC_API_KEY`.
