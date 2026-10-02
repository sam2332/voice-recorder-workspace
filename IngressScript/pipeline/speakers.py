"""Pure helpers for diarized speakers: re-joining split people, splitting lines, carrying names over."""
import re

import numpy as np

from core.config import log

def same_person_groups(emb: dict[str, np.ndarray], threshold: float, min_people: int = 0) -> dict[str, str]:
    """Diarization sometimes splits one person into two clusters. Join clusters whose voices are
    near-identical (most similar first), never going below `min_people`. Returns label -> representative."""
    labels = list(emb)
    parent = {l: l for l in labels}

    def find(l):
        while parent[l] != l:
            l = parent[l]
        return l

    pairs = sorted(((float(emb[a] @ emb[b]), a, b) for i, a in enumerate(labels) for b in labels[i + 1:]), reverse=True)
    people = len(labels)
    for sim, a, b in pairs:
        if sim < threshold or people <= min_people:
            break
        if find(a) != find(b):
            log(f"      {a} and {b} sound like the same person ({sim:.2f}); merging")
            parent[find(b)] = find(a)
            people -= 1
    return {l: find(l) for l in labels}

def split_by_speaker(segments: list[dict], language: str) -> list[dict]:
    """Whisper segments often span a change of speaker. Split them where the word-level speaker
    changes, ignoring 1-2 word blips under a second at the boundary (usually timing jitter)."""
    joiner = "" if language in ("zh", "ja", "th", "lo", "km", "my", "yue") else " "
    lines = []
    for seg in segments:
        words = [w for w in seg.get("words", []) if str(w.get("word", "")).strip()]
        if not words:
            if seg.get("text", "").strip():
                lines.append({"start": seg["start"], "end": seg["end"], "speaker": seg.get("speaker"),
                              "text": seg["text"].strip()})
            continue
        runs = []
        for w in words:
            spk = w.get("speaker") or (runs[-1]["speaker"] if runs else seg.get("speaker"))
            if not runs or runs[-1]["speaker"] != spk:
                runs.append({"speaker": spk, "words": [], "scores": [], "start": None, "end": None})
            r = runs[-1]
            r["words"].append(str(w["word"]).strip())
            if w.get("score") is not None:
                r["scores"].append(float(w["score"]))
            if w.get("start") is not None and r["start"] is None:
                r["start"] = w["start"]
            if w.get("end") is not None:
                r["end"] = w["end"]

        merged = []
        for r in runs:
            if r["start"] is None:
                r["start"] = merged[-1]["end"] if merged else seg["start"]
            if r["end"] is None:
                r["end"] = r["start"]
            tiny = len(r["words"]) <= 2 and r["end"] - r["start"] < 1.0
            # A real change of speaker almost always lands at the end of a sentence or after a pause;
            # anything else is diarization jitter (e.g. "Oh, that's pretty" / "fancy.")
            boundary = bool(merged) and (re.search(r"[.?!]$", merged[-1]["words"][-1]) or r["start"] - merged[-1]["end"] >= 0.5)
            if merged and (tiny or merged[-1]["speaker"] == r["speaker"] or not boundary):
                merged[-1]["words"] += r["words"]
                merged[-1]["scores"] += r["scores"]
                merged[-1]["end"] = max(merged[-1]["end"], r["end"])
            else:
                merged.append(r)
        if len(merged) > 1 and len(merged[0]["words"]) <= 2 and merged[0]["end"] - merged[0]["start"] < 1.0:
            first = merged.pop(0)
            merged[0]["words"] = first["words"] + merged[0]["words"]
            merged[0]["scores"] = first["scores"] + merged[0]["scores"]
            merged[0]["start"] = first["start"]
        for r in merged:
            lines.append({"start": r["start"], "end": r["end"], "speaker": r["speaker"],
                          "text": joiner.join(r["words"]),
                          "score": float(np.mean(r["scores"])) if r["scores"] else None})
    return lines

def names_from_previous(turns: list[tuple[float, float, str]], old_segments: list[dict]) -> dict[str, str]:
    """When re-transcribing a day, carry over the names from the old transcript (so renames like
    'Kenzie' survive) for voices that clearly line up with the same stretches of speech."""
    import bisect
    old = sorted((s["start"], s["end"], s["speaker"]) for s in old_segments
                 if s.get("speaker") and not s["speaker"].startswith("Unknown"))
    starts = [o[0] for o in old]
    overlap: dict[tuple[str, str], float] = {}
    total: dict[str, float] = {}
    for start, end, label in turns:
        i = max(0, bisect.bisect_left(starts, start) - 50)  # old lines are short; look back a little
        while i < len(old) and old[i][0] < end:
            o = min(end, old[i][1]) - max(start, old[i][0])
            if o > 0:
                overlap[(label, old[i][2])] = overlap.get((label, old[i][2]), 0) + o
                total[label] = total.get(label, 0) + o
            i += 1
    names, used = {}, set()
    for (label, name), secs in sorted(overlap.items(), key=lambda kv: -kv[1]):
        if label in names or name in used or secs < 10 or secs / total[label] < 0.6:
            continue
        names[label] = name
        used.add(name)
    return names
