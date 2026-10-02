"""TV / YouTube voice profiles and the People-page voice-profile listing."""
import json

from storage import init_db
from . import _state


def tv_names() -> set[str]:
    """Voice profiles the user marked as TV / YouTube (their lines are always hidden as noise)."""
    conn = init_db()
    try:
        return {r[0] for r in conn.execute("SELECT name FROM speakers WHERE kind = 'tv'")}
    finally:
        conn.close()


def mark_tv(name: str):
    conn = init_db()
    try:
        conn.execute("INSERT OR IGNORE INTO speakers (name, sample_count) VALUES (?, 0)", (name,))
        conn.execute("UPDATE speakers SET kind = 'tv' WHERE name = ?", (name,))
        conn.commit()
    finally:
        conn.close()


def voice_profiles() -> list[dict]:
    """Every voice profile in the DB with its voiceprints, and for each print a few clean lines of that
    voice on that day to listen to (so a print learned from the wrong voice is easy to spot)."""
    conn = init_db()
    try:
        rows = conn.execute("SELECT s.name, s.kind, v.id, v.day, v.label, v.seconds, v.created FROM speakers s "
                            "LEFT JOIN voiceprints v ON v.speaker_id = s.id ORDER BY s.name, v.created DESC").fetchall()
    finally:
        conn.close()
    load = _state.load_transcript()
    transcript_path = _state.transcript_path()
    day_dir = _state.day_dir()
    days: dict[str, dict] = {}

    def day_data(date):
        if date not in days:
            p = transcript_path(date)
            days[date] = load(p) if p.is_file() else {}
            if days[date]:
                wav = day_dir(date) / days[date].get("audio", "merged.wav")
                days[date]["_audio"] = f"/audio/{date}/{wav.name}?v={int(wav.stat().st_mtime)}" if wav.exists() else None
        return days[date]

    out: dict[str, dict] = {}
    for name, kind, pid, day, label, seconds, created in rows:
        prof = out.setdefault(name, {"name": name, "tv": kind == "tv", "prints": []})
        if pid is None:
            continue
        pr = {"id": pid, "day": day, "label": label, "seconds": round(seconds or 0, 1), "created": created, "samples": [], "audio": None}
        data = day_data(day) if day and day != "legacy" else {}
        if data:
            # Lines of the voice the print came from: its diarization label's current name on that day
            who = next((v["name"] for v in data.get("voices", []) if v.get("label") == label), name)
            if label == "lines":
                who = name
            segs = [s for s in data.get("segments", []) if s.get("speaker") == who and not s.get("noise")
                    and not s.get("overlap") and 1.5 <= s["end"] - s["start"] <= 15]
            segs.sort(key=lambda s: -(s["end"] - s["start"]))
            pr["samples"] = [{"start": s["start"], "end": s["end"], "text": s["text"]} for s in segs[:3]]
            pr["audio"] = data.get("_audio")
            pr["heard_as"] = who
        prof["prints"].append(pr)
    return sorted(out.values(), key=lambda p: (p["tv"], p["name"].lower()))


def delete_voiceprint(pid: int) -> str | None:
    conn = init_db()
    try:
        row = conn.execute("SELECT s.id, s.name FROM voiceprints v JOIN speakers s ON s.id = v.speaker_id WHERE v.id = ?",
                           (pid,)).fetchone()
        if not row:
            return None
        conn.execute("DELETE FROM voiceprints WHERE id = ?", (pid,))
        conn.execute("UPDATE speakers SET sample_count = (SELECT COUNT(*) FROM voiceprints WHERE speaker_id = ?) WHERE id = ?",
                     (row[0], row[0]))
        conn.commit()
        return row[1]
    finally:
        conn.close()


def delete_profile(name: str) -> bool:
    """Forget a voice profile and all its voiceprints. Transcripts keep the name on their lines."""
    conn = init_db()
    try:
        n = conn.execute("DELETE FROM speakers WHERE name = ?", (name,)).rowcount
        conn.commit()
        return n > 0
    finally:
        conn.close()


def set_profile_kind(name: str, tv: bool):
    conn = init_db()
    try:
        conn.execute("INSERT OR IGNORE INTO speakers (name, sample_count) VALUES (?, 0)", (name,))
        conn.execute("UPDATE speakers SET kind = ? WHERE name = ?", ("tv" if tv else None, name))
        conn.commit()
    finally:
        conn.close()
