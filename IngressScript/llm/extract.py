"""Overview: structured facts pulled out of each day as JSON."""
import re
import json
import time
from pathlib import Path

from core.config import log
from core.paths import all_transcripts, day_dir, transcript_path
from llm.ollama import ollama_chat, OLLAMA_MODEL
from llm.summary import clock_label, SUMMARY_CHUNK_CHARS, SUMMARY_CONTEXT, toDate_label, transcript_fingerprint
from transcripts.store import load_transcript
from voice_memory import tv_names

EXTRACT_DAYS = 30                  # how far back the Overview page looks, counted from the newest transcript

EXTRACT_KINDS = ["fact", "interaction", "task", "shopping", "idea", "decision", "plan"]

EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": EXTRACT_KINDS},
            "text": {"type": "string"},
            "people": {"type": "array", "items": {"type": "string"}},
            "line": {"type": "integer"},
        },
        "required": ["kind", "text", "people", "line"],
    }}},
    "required": ["items"],
}

EXTRACT_FORMAT = """Pull out everything from this transcript worth remembering later, as JSON: {"items": [...]}.
Each item has:
- "kind": one of
  fact        a thing worth remembering about a person or the world (their job, plans, preferences, numbers, names, dates)
  interaction a conversation or call: who it was with and what it was about
  task        something someone said they will do or need to do
  shopping    something the household is out of or needs to buy
  idea        a project or thing the owner or a roommate wants to make, build or try
  decision    something that was decided or agreed
  plan        an upcoming event, appointment or visit
- "text": one short self-contained sentence, so it makes sense in a table without the transcript
- "people": names of the people it involves, exactly as written in the transcript (empty list if nobody in particular)
- "line": the number from the [L..] tag of the line it came from (digits only, e.g. 12)
Skip small talk and filler. Never invent anything that isn't in the transcript. Return {"items": []} if nothing qualifies."""

def extract_path(date: str) -> Path:
    return day_dir(date) / "extract.json"

def load_extract(date: str) -> dict | None:
    """The saved extraction for a day, or None (missing or unreadable)."""
    try:
        return json.loads(extract_path(date).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

def clean_extract_items(raw, refs: dict[int, float], names: dict[str, str], sources: list[dict]) -> list[dict]:
    """Keep only well-formed items: a known kind, some text, a line that exists, people who were in the day."""
    out, seen = [], set()
    for it in raw if isinstance(raw, list) else []:
        if not isinstance(it, dict):
            continue
        kind = it.get("kind")
        text = re.sub(r"\s+", " ", str(it.get("text") or "")).strip()
        try:
            line = int(re.sub(r"\D", "", str(it.get("line"))) or -1)
        except ValueError:
            line = -1
        key = (kind, text.lower())
        if kind not in EXTRACT_KINDS or len(text) < 4 or key in seen:
            continue
        seen.add(key)
        people = []
        for n in it.get("people") if isinstance(it.get("people"), list) else []:
            real = names.get(re.sub(r"[\s_]+", " ", str(n)).strip().lower())
            if real and real not in people:
                people.append(real)
        item = {"kind": kind, "text": text, "people": people}
        if line in refs:
            item.update(line=line, start=refs[line], at=clock_label(sources, refs[line]))
        out.append(item)
    return out

def extract_day(date: str, progress=None) -> dict:
    """Ask the local model for a day's facts as JSON (constrained by EXTRACT_SCHEMA) and save them."""
    data = load_transcript(transcript_path(date))
    sources = data.get("sources", [])
    lines, refs, names = [], {}, {}
    tv = tv_names()
    for i, s in enumerate(data.get("segments", [])):
        if s.get("noise") or not s.get("text", "").strip():
            continue
        spk = s.get("speaker", "Unknown")
        label = spk.replace('_', ' ') + (" (on TV/YouTube)" if spk in tv else "")
        names[re.sub(r"[\s_]+", " ", spk).strip().lower()] = spk
        names[re.sub(r"[\s_]+", " ", label).strip().lower()] = spk
        refs[i + 1] = s["start"]
        lines.append(f"[L{i + 1}] {clock_label(sources, s['start'])} {label}: {s['text']}")
    if not lines:
        raise RuntimeError("There's no speech in this day's transcript.")
    parts, cur = [], []
    for line in lines:
        if cur and sum(len(l) + 1 for l in cur) + len(line) > SUMMARY_CHUNK_CHARS:
            parts.append(cur)
            cur = []
        cur.append(line)
    parts.append(cur)

    raw = []
    for n, part in enumerate(parts, 1):
        if progress:
            progress((n - 1) / len(parts), f"Reading part {n} of {len(parts)}" if len(parts) > 1 else "Reading the day")
        text = ollama_chat(f"Transcript for {toDate_label(date)}" + (f" (part {n} of {len(parts)})" if len(parts) > 1 else "") +
                           ":\n\n" + "\n".join(part) + "\n\n" + EXTRACT_FORMAT, SUMMARY_CONTEXT,
                           max_tokens=2500, fmt=EXTRACT_SCHEMA)
        try:
            raw += json.loads(text).get("items", [])
        except (json.JSONDecodeError, AttributeError):
            log(f"[overview] {date} part {n}: the model's answer wasn't valid JSON; skipped")
    items = clean_extract_items(raw, refs, names, sources)
    result = {"items": items, "model": OLLAMA_MODEL, "created": time.time(), "fingerprint": transcript_fingerprint(data)}
    tmp = extract_path(date).with_suffix(".tmp")
    tmp.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(extract_path(date))
    return result

def extract_status(date: str, data: dict | None = None) -> str:
    """'ready', 'outdated' (the transcript changed since) or 'missing'."""
    saved = load_extract(date)
    if not saved:
        return "missing"
    data = data or load_transcript(transcript_path(date))
    return "ready" if saved.get("fingerprint") == transcript_fingerprint(data) else "outdated"

def overview_data(days: int = EXTRACT_DAYS) -> dict:
    """Everything the Overview page shows, read from disk only (no model call): per day, who was
    heard and the extracted items. Days are counted back from the newest transcript."""
    from datetime import date as _d, timedelta
    found = all_transcripts()
    tv = tv_names()   # TV voices aren't people you saw
    out = []
    if found:
        cutoff = (_d.fromisoformat(found[-1][0]) - timedelta(days=max(1, days))).isoformat()
        for date, path in reversed(found):
            if date < cutoff:
                break
            try:
                data = load_transcript(path)
            except (OSError, json.JSONDecodeError):
                continue
            heard: dict[str, dict] = {}
            for seg in data.get("segments", []):
                name = seg.get("speaker")
                if not name or name.startswith("Unknown") or seg.get("noise") or name in tv:
                    continue
                p = heard.setdefault(name, {"name": name, "seconds": 0.0, "lines": 0, "first_line": seg["start"]})
                p["seconds"] += max(0.0, seg["end"] - seg["start"]); p["lines"] += 1
            saved = load_extract(date)
            out.append({
                "date": date, "recordings": len(data.get("sources", [])),
                "speakers": sorted(({**p, "seconds": round(p["seconds"], 1)} for p in heard.values()), key=lambda p: -p["seconds"]),
                "extract": extract_status(date, data),
                "items": saved["items"] if saved else [],
            })
    return {"days": out}
