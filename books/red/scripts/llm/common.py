"""Shared helpers for the LLM extraction pipeline (Red Murphy / Essential
Grammar in Use, Russian edition).

Book layout (book.pdf, 1-based PDF page numbers):
  unit N theory page     = 2N + 11
  unit N exercise page   = 2N + 12        (units 1..115 -> pages 13..242)
  additional exercises   = 253..270
  answer key (units)     = 282..311
  answer key (additional)= 312..313

The OpenAI-compatible endpoint is configured via .env (OPENAI_BASE_URL,
OPENAI_API_KEY); every call is logged with token usage and cost to
work/llm/calls.jsonl.
"""
import base64
import io
import json
import os
import re
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "book.pdf"
EPUB_HTML = ROOT / "original" / "EPUB" / "OEBPS" / "html"
IMG = ROOT / "work" / "img"
LLM = ROOT / "work" / "llm"

N_UNITS = 115
KEY_PAGES = list(range(282, 312))
ADD_KEY_PAGES = [312, 313]
ADD_PAGES = list(range(252, 271))


def unit_pages(n):
    return [2 * n + 11, 2 * n + 12]


def exercise_page(n):
    return 2 * n + 12


def load_env():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def page_image(p, max_side=None):
    """JPEG bytes of a rendered page (work/img/pNNN.jpg), optionally downscaled."""
    path = IMG / ("p%03d.jpg" % p)
    if not path.exists():
        raise FileNotFoundError("%s (run scripts/llm/render_pages.py)" % path)
    data = path.read_bytes()
    if not max_side:
        return data
    from PIL import Image

    im = Image.open(io.BytesIO(data))
    if max(im.size) <= max_side:
        return data
    im.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88)
    return buf.getvalue()


def image_part(jpeg):
    b64 = base64.b64encode(jpeg).decode("ascii")
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b64}}


_pricing = None
_pricing_lock = threading.Lock()
_log_lock = threading.Lock()
# per-process spend cap (logged cost, RUB); set via LLM_BUDGET env or set_budget()
_budget = {"cap": float(os.environ.get("LLM_BUDGET", "15")), "spent": 0.0}


def set_budget(cap):
    _budget["cap"] = cap


def pricing(router):
    """{model_id: (prompt_price, completion_price)} per token for the default
    endpoint, cached on disk (OpenRouter models are used only when free)."""
    client = router.get("default")
    global _pricing
    with _pricing_lock:
        if _pricing is None:
            cache = LLM / "models.json"
            if not cache.exists() or time.time() - cache.stat().st_mtime > 86400:
                LLM.mkdir(parents=True, exist_ok=True)
                models = client.models.list()
                cache.write_text(
                    json.dumps([m.model_dump() for m in models.data], ensure_ascii=False),
                    encoding="utf-8",
                )
            _pricing = {}
            for m in json.loads(cache.read_text(encoding="utf-8")):
                p = m.get("pricing") or {}
                _pricing[m["id"]] = (float(p.get("prompt") or 0), float(p.get("completion") or 0))
        return _pricing


class Router:
    """Lazily created OpenAI clients per provider. A model id prefixed with
    "openrouter:" goes to OpenRouter (OPENROUTER_*), anything else to the
    default endpoint (OPENAI_*)."""

    def __init__(self):
        load_env()
        self._clients = {}

    def get(self, provider):
        if provider not in self._clients:
            import httpx
            from openai import OpenAI

            env = "OPENROUTER" if provider == "openrouter" else "OPENAI"
            self._clients[provider] = OpenAI(
                base_url=os.environ[env + "_BASE_URL"],
                api_key=os.environ[env + "_API_KEY"],
                # read = max silence between stream chunks; the first chunk can
                # take minutes when the provider queues (time to first token)
                timeout=httpx.Timeout(20.0, read=300.0),
                max_retries=0,  # every retry is billed; chat() retries only on errors
            )
        return self._clients[provider]

    def resolve(self, model):
        if model.startswith("openrouter:"):
            return self.get("openrouter"), model.split(":", 1)[1], "openrouter"
        return self.get("default"), model, "default"


def client():
    return Router()


def _log(entry):
    with _log_lock:
        LLM.mkdir(parents=True, exist_ok=True)
        with open(LLM / "calls.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _stream(api, model_id, msgs, max_tokens, temperature):
    """Streamed completion -> (text, usage, finish). Streaming keeps the
    connection busy during long reasoning, so proxies do not drop it (a drop
    after the provider has started generating is still billed)."""
    s = api.chat.completions.create(
        model=model_id, messages=msgs, max_tokens=max_tokens, temperature=temperature,
        stream=True, stream_options={"include_usage": True},
    )
    text, usage, finish = [], None, None
    for ch in s:
        if ch.choices:
            d = ch.choices[0].delta
            if d and d.content:
                text.append(d.content)
            finish = ch.choices[0].finish_reason or finish
        if ch.usage:
            usage = ch.usage
    return "".join(text), usage, finish


def chat(cl, model, system, content, tag, max_tokens=16000, temperature=0.1, retries=2):
    """One chat call; returns (text, meta). Logs usage/cost to calls.jsonl.

    Connection failures before the request reaches the provider are free and
    retried with backoff; failures after that (mid-stream drops, empty or
    truncated replies) count against `retries` because they may be billed."""
    from openai import APIConnectionError, APITimeoutError

    msgs = [{"role": "system", "content": system}, {"role": "user", "content": content}]
    api, model_id, provider = cl.resolve(model)
    last, billed_tries, connect_fails = None, 0, 0
    while billed_tries < retries:
        if _budget["spent"] >= _budget["cap"]:
            raise RuntimeError("budget cap %.2f reached" % _budget["cap"])
        t0 = time.time()
        got_response = False
        try:
            text, u, finish = _stream(api, model_id, msgs, max_tokens, temperature)
            got_response = True
        except (APIConnectionError, APITimeoutError) as e:
            last = e
            # a connect error within a few seconds never reached the model
            early = time.time() - t0 < 25
            _log({"tag": tag, "model": model, "error": str(e)[:200], "early": early,
                  "secs": round(time.time() - t0, 1), "cost": 0})
            if early and connect_fails < 8:
                connect_fails += 1
                time.sleep(3 * connect_fails)
                continue
            billed_tries += 1
            time.sleep(5)
            continue
        except Exception as e:  # HTTP 4xx/5xx: rejected, not billed
            last = e
            _log({"tag": tag, "model": model, "error": str(e)[:200],
                  "secs": round(time.time() - t0, 1), "cost": 0})
            billed_tries += 1
            time.sleep(10)
            continue
        billed_tries += 1
        meta = {
            "tag": tag,
            "model": model,
            "secs": round(time.time() - t0, 1),
            "prompt_tokens": getattr(u, "prompt_tokens", 0) if u else 0,
            "completion_tokens": getattr(u, "completion_tokens", 0) if u else 0,
            "finish": finish,
        }
        real = getattr(u, "cost", None) if u else None
        if real is None and u is not None:
            real = (u.model_extra or {}).get("cost")
        if real is not None:
            meta["cost"] = round(float(real), 4)
        else:
            pin, pout = (0.0, 0.0) if provider == "openrouter" else pricing(cl).get(model, (0.0, 0.0))
            meta["cost"] = round(meta["prompt_tokens"] * pin + meta["completion_tokens"] * pout, 4)
        _budget["spent"] += meta["cost"]
        _log(meta)
        if text.strip() and finish != "length":
            return text, meta
        last = RuntimeError("empty/truncated response (finish=%s)" % finish)
        if finish == "length":
            break  # a retry would truncate again
    raise RuntimeError("%s %s failed: %s" % (model, tag, last))


def _balance(s):
    """Fix mismatched/missing closing brackets outside strings (a common
    model slip: `[["a"]}`)."""
    out, stack, in_str, esc = [], [], False, False
    pairs = {"{": "}", "[": "]"}
    for ch in s:
        if in_str:
            out.append(ch)
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in pairs:
            stack.append(pairs[ch])
        elif ch in "}]":
            while stack and stack[-1] != ch:
                out.append(stack.pop())  # close what the model forgot
            if not stack:
                continue  # stray closer
            stack.pop()
        out.append(ch)
    out.extend(reversed(stack))
    return "".join(out)


def extract_json(text):
    """Parse the JSON object from a model reply (tolerates ```json fences,
    prose around it and unbalanced brackets)."""
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    s = m.group(1) if m else text[text.find("{"): text.rfind("}") + 1]
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return json.loads(_balance(s))


def safe_name(model):
    return model.replace("/", "__")
