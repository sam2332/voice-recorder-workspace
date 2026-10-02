"""Talking to the local Ollama server (streamed, capped output)."""
import os
import re
import json

from llm.markdown import dedupe_lines

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3.5:35b-a3b")

SUMMARY_CTX = 16384                # model context window (tokens) to ask Ollama for

def ollama_chat(prompt: str, system: str, max_tokens: int = 1500, on_token=None, fmt: dict | None = None) -> str:
    """One answer from the local model, streamed so progress can be shown. Output is capped and
    repetition discouraged: an uncapped run once got stuck repeating itself for 10+ minutes."""
    import urllib.request
    import urllib.error
    body = json.dumps({
        "model": OLLAMA_MODEL, "stream": True, "think": False, "keep_alive": "2m",
        "options": {"num_ctx": SUMMARY_CTX, "temperature": 0.3, "num_predict": max_tokens, "repeat_penalty": 1.1},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        **({"format": fmt} if fmt else {}),   # a JSON schema: the answer is forced to match it
    }).encode("utf-8")
    req = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=body, headers={"Content-Type": "application/json"})
    parts, n = [], 0
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            for raw in r:
                if not raw.strip():
                    continue
                msg = json.loads(raw.decode("utf-8"))
                if msg.get("error"):
                    raise RuntimeError(f"Ollama said: {msg['error']}")
                piece = msg.get("message", {}).get("content", "")
                if piece:
                    parts.append(piece)
                    n += 1
                    if on_token and n % 20 == 0:
                        on_token(n)
                if msg.get("done"):
                    break
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")
        raise RuntimeError(f"Ollama said: {detail or e}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise RuntimeError(f"Couldn't reach Ollama at {OLLAMA_URL} ({e}). Is it running?") from e
    text = re.sub(r"(?s)<think>.*?</think>",
                    "", "".join(parts)).strip()   # in case the model thinks anyway
    return text if fmt else dedupe_lines(text)

def ollama_problems() -> list[str]:
    import urllib.request
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=5) as r:
            names = {m["name"] for m in json.loads(r.read().decode("utf-8")).get("models", [])}
    except Exception as e:
        return [f"Ollama isn't reachable at {OLLAMA_URL} ({e}). Start Ollama and try again."]
    if OLLAMA_MODEL not in names and f"{OLLAMA_MODEL}:latest" not in names:
        return [f"The model {OLLAMA_MODEL} isn't installed in Ollama. Run: ollama pull {OLLAMA_MODEL}"]
    return []
