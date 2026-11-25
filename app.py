"""VoiceMate - a voice assistant website.

The browser does the listening (speech recognition) and the speaking (speech
synthesis). This Flask server does the thinking: quick offline skills first,
then the Claude AI API for everything else. The API key stays on the server.
"""
import os
import time
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from flask import Flask, jsonify, render_template, request

from skills import try_local

BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv(path):
    """Tiny .env reader so you don't need python-dotenv."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(BASE_DIR / ".env")

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")
API_URL = "https://api.anthropic.com/v1/messages"
MAX_CHARS = 500          # longest message accepted
MAX_TURNS = 12           # how much recent conversation is sent to the AI
RATE_PER_MIN = int(os.environ.get("RATE_LIMIT_PER_MIN", "20"))

OFFLINE_MSG = ("I'm in offline mode, so I can only tell the time and date, do maths and tell jokes. "
               "Add an Anthropic API key on the server to unlock full answers.")

app = Flask(__name__)

if os.environ.get("TRUST_PROXY") == "1":  # set on hosts like Render so rate limits see real client IPs
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
_hits = defaultdict(deque)


def rate_limited(ip):
    """Simple per-IP limit so a public site can't drain the API budget."""
    now = time.monotonic()
    if len(_hits) > 5000:  # drop stale entries
        for k in [k for k, q in _hits.items() if not q or now - q[-1] > 60]:
            del _hits[k]
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_PER_MIN:
        return True
    q.append(now)
    return False


def valid_tz(name):
    try:
        ZoneInfo(str(name))
        return str(name)
    except Exception:
        return None


def build_messages(history, message):
    """Clean the client-supplied history into what the API requires:
    alternating user/assistant turns that start with a user turn."""
    turns = []
    for item in (history if isinstance(history, list) else []):
        if not isinstance(item, dict):
            continue
        role, content = item.get("role"), item.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            turns.append({"role": role, "content": content.strip()[:MAX_CHARS * 2]})
    turns.append({"role": "user", "content": message})

    merged = []
    for t in turns:  # merge consecutive turns from the same speaker
        if merged and merged[-1]["role"] == t["role"]:
            merged[-1]["content"] += "\n" + t["content"]
        else:
            merged.append(dict(t))
    merged = merged[-MAX_TURNS:]
    while merged and merged[0]["role"] != "user":
        merged.pop(0)
    return merged


class AIError(Exception):
    """An error whose message is safe to show to the user."""


def ask_ai(messages, tz):
    try:
        now = datetime.now(ZoneInfo(tz)) if tz else datetime.now().astimezone()
    except Exception:
        now = datetime.now().astimezone()
    system = (
        "You are VoiceMate, a friendly voice assistant. Your reply will be read aloud, so answer in one to "
        "three short, natural spoken sentences. Use plain text only: no markdown, lists, emojis or web "
        "addresses. Reply in the language the user spoke. If you don't know something, say so. You can only "
        "talk: never claim to set alarms, make calls or take real-world actions. "
        f"Current local date and time: {now.strftime('%A, %d %B %Y, %I:%M %p')}."
    )
    try:
        resp = requests.post(
            API_URL,
            headers={"x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": MODEL, "max_tokens": 400, "system": system, "messages": messages},
            timeout=30,
        )
    except requests.RequestException as exc:
        app.logger.warning("AI request failed: %s", exc)
        raise AIError("I couldn't reach the AI service. Please try again.")

    if resp.status_code != 200:
        app.logger.warning("AI error %s: %s", resp.status_code, resp.text[:300])
        if resp.status_code in (401, 403):
            raise AIError("The server's API key was rejected. Check ANTHROPIC_API_KEY.")
        if resp.status_code == 429:
            raise AIError("The AI service is busy right now. Please try again in a moment.")
        raise AIError("The AI service had a problem. Please try again.")

    blocks = resp.json().get("content", [])
    text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
    if not text:
        raise AIError("I didn't get an answer back. Please try again.")
    return text


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/status")
def status():
    return jsonify(ai=bool(API_KEY), model=MODEL if API_KEY else None)


@app.post("/api/chat")
def chat():
    if rate_limited(request.remote_addr or "unknown"):
        return jsonify(error="You're talking fast! Give me a moment and try again."), 429

    data = request.get_json(silent=True) or {}
    message = str(data.get("message", "")).strip()[:MAX_CHARS]
    if not message:
        return jsonify(error="I didn't catch anything. Please try again."), 400
    tz = valid_tz(data.get("tz"))

    local = try_local(message, tz)
    if local:
        return jsonify(reply=local, source="local")

    if not API_KEY:
        return jsonify(reply=OFFLINE_MSG, source="offline")

    try:
        reply = ask_ai(build_messages(data.get("history"), message), tz)
    except AIError as exc:
        return jsonify(error=str(exc)), 502
    return jsonify(reply=reply, source="ai")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=os.environ.get("FLASK_DEBUG") == "1")
