"""Meetings: lines (or whole segments) the user marked, possibly across days. Stored in meetings.json."""
import re
import json
import threading
from pathlib import Path

from core.config import DATE_RE, OUTPUT_DIR
from core.paths import transcript_path
from llm.summary import clock_label
from transcripts.store import load_transcript, transcript_sources

MEETINGS_LOCK = threading.RLock()

def meetings_path() -> Path:
    return OUTPUT_DIR / "meetings.json"

def load_meetings() -> list[dict]:
    try:
        return json.loads(meetings_path().read_text(encoding="utf-8")).get("meetings", [])
    except (OSError, json.JSONDecodeError):
        return []

def update_meetings(fn):
    """Run fn(meetings) on the saved list and save it; fn's return value is passed back."""
    with MEETINGS_LOCK:
        meetings = load_meetings()
        result = fn(meetings)
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        tmp = meetings_path().with_suffix(".tmp")
        tmp.write_text(json.dumps({"meetings": meetings}, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(meetings_path())
        return result

def get_meeting(mid: str) -> dict | None:
    return next((m for m in load_meetings() if m["id"] == mid), None)

def clean_meeting_items(items: list[dict]) -> list[dict]:
    out = []
    for it in items:
        try:
            date, start = str(it["date"]), round(float(it["start"]), 2)
        except (KeyError, TypeError, ValueError):
            continue
        if DATE_RE.match(date):
            out.append({"date": date, "start": start, "text": str(it.get("text", ""))})
    return out

def meeting_lines(m: dict) -> tuple[list[dict], int]:
    """The marked lines as they are in the transcripts now, oldest first, plus how many have gone
    (trashed, or their day was re-transcribed)."""
    by_date: dict[str, list[dict]] = {}
    for it in m["items"]:
        by_date.setdefault(it["date"], []).append(it)
    out, missing = [], 0
    for date in sorted(by_date):
        if not transcript_path(date).is_file():
            missing += len(by_date[date])
            continue
        data = load_transcript(transcript_path(date))
        segs, sources = data.get("segments", []), transcript_sources(data)
        used = set()
        for it in by_date[date]:
            near = [s for s in segs if abs(s["start"] - it["start"]) < 0.05 and id(s) not in used]
            seg = next((s for s in near if s["text"] == it["text"]), near[0] if near else None)
            if seg is None:
                missing += 1
                continue
            used.add(id(seg))
            out.append({"date": date, "start": seg["start"], "end": seg["end"], "speaker": seg.get("speaker", "Unknown"),
                        "text": seg["text"], "at": clock_label(sources, seg["start"])})
    out.sort(key=lambda l: (l["date"], l["start"]))
    return out, missing

def meeting_fingerprint(lines: list[dict]) -> str:
    import hashlib
    body = [(l["date"], l["start"], l["speaker"], l["text"]) for l in lines]
    return hashlib.sha1(json.dumps(body, ensure_ascii=False).encode("utf-8")).hexdigest()

def meeting_facts(m: dict) -> dict:
    """What the Meetings page shows without opening a meeting: size, who, when, and the summary's state."""
    lines, missing = meeting_lines(m)
    talk: dict[str, float] = {}
    span: dict[str, list[float]] = {}
    for l in lines:
        talk[l["speaker"]] = talk.get(l["speaker"], 0.0) + l["end"] - l["start"]
        s = span.setdefault(l["date"], [l["start"], l["end"]])
        s[0], s[1] = min(s[0], l["start"]), max(s[1], l["end"])
    saved = m.get("summary")
    overview = ""
    if saved:
        hit = re.search(r"(?ms)^## Overview\s*\n(.+?)(?=^## |\Z)", saved.get("markdown", ""))
        overview = re.sub(r"\s*\[L[\d\sL,\u2013-]*\]", "", hit.group(1)).strip() if hit else ""
    return {"id": m["id"], "name": m["name"], "created": m.get("created"), "lines": len(lines), "missing": missing,
            "marks": [[it["date"], it["start"]] for it in m["items"]],
            "days": sorted(span), "span": round(sum(b - a for a, b in span.values())),
            "people": [{"name": n, "seconds": round(t)} for n, t in sorted(talk.items(), key=lambda kv: -kv[1])],
            "first": {"date": lines[0]["date"], "start": lines[0]["start"], "at": lines[0]["at"]} if lines else None,
            "summary": ({"created": saved.get("created"), "model": saved.get("model"), "overview": overview,
                         "outdated": saved.get("fingerprint") != meeting_fingerprint(lines)} if saved else None)}
