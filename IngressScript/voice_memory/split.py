"""Splitting one diarization voice that is really several people."""
import numpy as np

from app_config import (SPLIT_MIN_SECONDS, SPLIT_MATCH, SPLIT_MARGIN,
                        SPLIT_STRONG, SPLIT_STRONG_MARGIN)
from storage import init_db
from . import _state
from .memory import unit, VoiceMemory
from .teaching import line_voices, _same_line


def split_voice(date: str, speaker: str, seeds: dict[str, list[dict]]) -> list[dict]:
    """One diarization voice that is really several people: the user tags a few of its lines per person
    (`seeds`), and every other line of that voice is scored against each person's tagged lines (mean of the
    3 closest) and, if they have one, their saved voice profile (minus this day's print of `speaker`).
    Returns a suggestion per line that scores clearly closer to one person."""
    data = _state.load_transcript()(_state.transcript_path()(date))
    segs = [s for s in data.get("segments", []) if s.get("speaker") == speaker and not s.get("noise")]
    seed_segs = {p: [s for s in segs if any(_same_line(s, l) for l in ls)] for p, ls in seeds.items()}
    seeded = [s for ss in seed_segs.values() for s in ss]
    cand = [s for s in segs if s not in seeded and s["end"] - s["start"] >= SPLIT_MIN_SECONDS]
    usable = lambda s: s["end"] - s["start"] >= 1.0
    embs = line_voices.embed(date, [(s["start"], s["end"]) for s in cand + [s for s in seeded if usable(s)]])
    key = lambda s: (round(s["start"], 2), round(s["end"], 2))
    groups = {p: np.array([embs[key(s)] for s in ss if key(s) in embs]) for p, ss in seed_segs.items()}
    conn = init_db()
    try:
        prof: dict[str, list] = {}
        for name, blob, day, label in conn.execute(
                "SELECT s.name, v.embedding, v.day, v.label FROM speakers s JOIN voiceprints v ON v.speaker_id = s.id"):
            if name in seeds and not (day == date and name == speaker):
                prof.setdefault(name, []).append(unit(np.frombuffer(blob, dtype=np.float32)))
    finally:
        conn.close()
    out = []
    for s in cand:
        e = embs.get(key(s))
        if e is None:
            continue
        scores = []
        for p in seeds:
            sc = [float(np.sort(groups[p] @ e)[::-1][:3].mean())] if len(groups.get(p, [])) else []
            if prof.get(p):
                sc.append(VoiceMemory.score(e, np.array(prof[p])))
            if sc:
                scores.append((max(sc), p))
        scores.sort(reverse=True)
        if not scores:
            continue
        best, who = scores[0]
        margin = best - (scores[1][0] if len(scores) > 1 else 0.0)
        if best >= SPLIT_MATCH and margin >= SPLIT_MARGIN:
            out.append({"start": s["start"], "end": s["end"], "text": s["text"], "person": who, "score": round(best, 3),
                        "margin": round(margin, 3), "strong": best >= SPLIT_STRONG and margin >= SPLIT_STRONG_MARGIN})
    return out
