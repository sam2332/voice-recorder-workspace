"""Everyone across all transcripts, and the CLI rename."""
import sys
import json

from core.config import log
from core.paths import all_transcripts
from llm.extract import load_extract
from storage import init_db
from transcripts.store import load_transcript
from voice_memory import NameTaken, rename_speaker_core, RenameError, tv_names

def people_summary() -> list[dict]:
    """Everyone named in any transcript: the days and recordings they're in and how much they talked."""
    people: dict[str, dict] = {}
    tv = tv_names()
    for date, path in all_transcripts():
        try:
            data = load_transcript(path)
        except (OSError, json.JSONDecodeError):
            continue
        sources = [s for s in data.get("sources", []) if isinstance(s, dict) and "start" in s]
        for seg in data.get("segments", []):
            name = seg.get("speaker")
            if not name or name.startswith("Unknown") or seg.get("noise"):
                continue
            p = people.setdefault(name, {"name": name, "seconds": 0.0, "lines": 0, "days": {}})
            d = p["days"].setdefault(date, {"date": date, "seconds": 0.0, "lines": 0, "recordings": {}})
            secs = max(0.0, seg["end"] - seg["start"])
            p["seconds"] += secs; p["lines"] += 1
            d["seconds"] += secs; d["lines"] += 1
            # Which recording of the day this line came from
            src = next((s for s in reversed(sources) if s["start"] <= seg["start"] + 0.01), None)
            if src:
                r = d["recordings"].setdefault(src["name"], {"name": src["name"], "recorded_at": src.get("recorded_at"),
                                                             "offset": src["start"], "first_line": seg["start"],
                                                             "seconds": 0.0, "lines": 0})
                r["seconds"] += secs; r["lines"] += 1
    conn = init_db()
    try:
        prints = dict(conn.execute("SELECT s.name, COUNT(v.id) FROM speakers s LEFT JOIN voiceprints v "
                                   "ON v.speaker_id = s.id GROUP BY s.id").fetchall())
    finally:
        conn.close()
    out = []
    for p in people.values():
        days = sorted(p["days"].values(), key=lambda d: d["date"], reverse=True)
        for d in days:
            d["seconds"] = round(d["seconds"], 1)
            d["recordings"] = sorted(d["recordings"].values(), key=lambda r: r["offset"])
            for r in d["recordings"]:
                r["seconds"] = round(r["seconds"], 1)
        # Recent things extracted for the Overview that involve this person, newest first
        highlights = []
        for d in days:
            saved = load_extract(d["date"])
            for it in (saved or {}).get("items", []):
                if p["name"] in it.get("people", []):
                    highlights.append({**it, "date": d["date"]})
            if len(highlights) >= 12:
                break
        out.append({"name": p["name"], "seconds": round(p["seconds"], 1), "lines": p["lines"], "highlights": highlights[:12],
                    "days": days, "recordings": sum(len(d["recordings"]) for d in days),
                    "first_seen": days[-1]["date"], "last_seen": days[0]["date"],
                    "voiceprints": prints.get(p["name"], 0), "tv": p["name"] in tv})
    return sorted(out, key=lambda p: (-len(p["days"]), -p["seconds"]))

def rename_speaker(old: str, new: str, merge: bool = False):
    try:
        updated = rename_speaker_core(old, new, merge)
    except NameTaken as e:
        log(f"{e}  (use --merge \"{old}\" \"{new}\")")
        sys.exit(1)
    except RenameError as e:
        log(str(e))
        sys.exit(1)
    log(f"{'Merged' if merge else 'Renamed'} '{old}' -> '{new}' (updated {updated} transcript(s)).")
