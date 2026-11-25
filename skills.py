"""Quick offline "skills": things the assistant can answer instantly and exactly
without calling the AI (time, date, simple maths, jokes, greetings)."""
import ast
import operator
import random
import re
from datetime import datetime
from zoneinfo import ZoneInfo

JOKES = [
    "Why do programmers prefer dark mode? Because light attracts bugs.",
    "I would tell you a UDP joke, but you might not get it.",
    "Why did the developer go broke? Because he used up all his cache.",
    "There are only 10 kinds of people: those who understand binary and those who don't.",
    "A SQL query walks into a bar, goes up to two tables and asks: can I join you?",
    "Why was the computer cold? It left its Windows open.",
]

GREETINGS = {"hi", "hello", "hey", "hii", "hey there", "hello there", "good morning",
             "good afternoon", "good evening", "namaste"}

_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.Mod: operator.mod, ast.Pow: operator.pow,
    ast.USub: operator.neg, ast.UAdd: operator.pos,
}


def _now(tz):
    try:
        return datetime.now(ZoneInfo(tz)) if tz else datetime.now().astimezone()
    except Exception:
        return datetime.now().astimezone()


def _safe_eval(node):
    """Evaluate a tiny arithmetic AST. Anything other than numbers and basic
    operators raises ValueError, so this can never run arbitrary code."""
    if isinstance(node, ast.Expression):
        return _safe_eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_safe_eval(node.operand))
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        left, right = _safe_eval(node.left), _safe_eval(node.right)
        if isinstance(node.op, ast.Pow) and (abs(right) > 100 or abs(left) > 1e6):
            raise ValueError("exponent too large")
        return _OPS[type(node.op)](left, right)
    raise ValueError("unsupported expression")


_WORD_OPS = [
    (r"\braised to the power of\b|\bto the power of\b|\bpower\b", "**"),
    (r"\bmultiplied by\b|\btimes\b|\binto\b|\bx\b", "*"),
    (r"\bdivided by\b|\bover\b", "/"),
    (r"\bplus\b|\band\b", "+"),
    (r"\bminus\b|\bsubtract\b|\bless\b", "-"),
    (r"\bmod\b|\bmodulo\b", "%"),
]


def _math(text):
    t = text.lower().strip().rstrip("?.! ")
    t = re.sub(r"^(please\s+)?(can you\s+)?(calculate|compute|work out|what is|what's|whats|how much is|solve)\s+", "", t)
    t = re.sub(r"(\d)\s*,\s*(\d{3})", r"\1\2", t)  # 1,000 -> 1000
    t = re.sub(r"(\d+(?:\.\d+)?)\s*(?:squared)\b", r"(\1)**2", t)
    t = re.sub(r"(\d+(?:\.\d+)?)\s*(?:cubed)\b", r"(\1)**3", t)
    t = re.sub(r"(\d+(?:\.\d+)?)\s*percent of\s*(\d+(?:\.\d+)?)", r"(\1/100*\2)", t)
    for pattern, symbol in _WORD_OPS:
        t = re.sub(pattern, f" {symbol} ", t)
    t = t.replace("^", "**").replace("×", "*").replace("÷", "/")
    t = re.sub(r"\s+", " ", t).strip()
    if not re.fullmatch(r"[\d\s.+\-*/%()]+", t) or not re.search(r"\d", t) or not re.search(r"[+\-*/%]", t):
        return None
    try:
        result = _safe_eval(ast.parse(t, mode="eval"))
    except (ValueError, SyntaxError, ZeroDivisionError, OverflowError):
        return "I couldn't work that out. Try saying it a different way."
    if isinstance(result, float):
        result = int(result) if result.is_integer() else round(result, 6)
    return f"The answer is {result:,}" if isinstance(result, int) and abs(result) >= 10000 else f"The answer is {result}"


def try_local(text, tz=None):
    """Return an instant reply, or None if the AI should handle it."""
    t = re.sub(r"[^\w\s'?]", "", text.lower()).strip()

    if t in GREETINGS:
        return "Hello! I'm VoiceMate. Ask me anything."

    if re.search(r"\b(what('s| is)? the time|current time|time (is it|now)|tell me the time)\b", t):
        now = _now(tz)
        return f"It's {now.strftime('%I:%M %p').lstrip('0')}."

    if re.search(r"\b(today'?s date|what('s| is)? (the )?(date|day)( today)?|what day is (it|today)|which day is (it|today))\b", t):
        now = _now(tz)
        return f"Today is {now.strftime('%A, %d %B %Y').lstrip('0')}."

    if re.search(r"\b(tell me a joke|another joke|joke)\b", t) and len(t.split()) <= 6:
        return random.choice(JOKES)

    return _math(text)
