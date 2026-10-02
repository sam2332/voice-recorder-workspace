"""Voice matching against a persistent database of people and their voiceprints."""
import time
import re

import numpy as np

from app_config import MATCH_THRESHOLD, SUGGEST_THRESHOLD, MIN_VOICE_SECONDS, MAX_VOICEPRINTS
from storage import init_db
from . import _state


def unit(v) -> np.ndarray:
    v = np.asarray(v, dtype=np.float32).flatten()
    return v / (np.linalg.norm(v) or 1.0)


class VoiceMemory:
    """Remembers people across days. Each person has several voiceprints (one per day heard)."""

    def __init__(self):
        self.conn = None   # opened per assign() call: SQLite connections can't cross threads,
                           # and the background worker thread changes between jobs

    def people(self) -> dict[int, tuple[str, np.ndarray]]:
        rows = self.conn.execute(
            "SELECT s.id, s.name, v.embedding, v.day FROM speakers s JOIN voiceprints v ON v.speaker_id = s.id"
        ).fetchall()
        prints: dict[int, dict] = {}
        for spk_id, name, blob, day in rows:
            p = prints.setdefault(spk_id, {"name": name, "new": [], "legacy": []})
            p["legacy" if day == "legacy" else "new"].append(unit(np.frombuffer(blob, dtype=np.float32)))
        # Legacy prints came from an older, noisier method; ignore them once real ones exist
        return {i: (p["name"], np.array(p["new"] or p["legacy"])) for i, p in prints.items()}

    @staticmethod
    def score(emb: np.ndarray, prints: np.ndarray) -> float:
        """Average of the 3 closest voiceprints: robust to one odd day, but not fooled by a single fluke."""
        sims = np.sort(prints @ emb)[::-1]
        return float(sims[:3].mean())

    def _unique_name(self) -> str:
        existing = {r[0] for r in self.conn.execute("SELECT name FROM speakers")}
        n = (self.conn.execute("SELECT COALESCE(MAX(id), 0) FROM speakers").fetchone()[0]) + 1
        while f"Speaker_{n}" in existing:
            n += 1
        return f"Speaker_{n}"

    def _speaker_id(self, name: str) -> int:
        row = self.conn.execute("SELECT id FROM speakers WHERE name = ?", (name,)).fetchone()
        if row:
            return row[0]
        return self.conn.execute("INSERT INTO speakers (name, sample_count) VALUES (?, 0)", (name,)).lastrowid

    def assign(self, day: str, voices: dict[str, tuple[np.ndarray, float]], prior: dict[str, str]) -> tuple[dict, dict]:
        """Name today's voices. `voices` maps label -> (embedding, seconds spoken); `prior` maps
        label -> name kept from an earlier transcript of this same day (so renames survive).
        Returns (label -> name, label -> {"match", "candidates"}) where candidates are the closest
        known people with their similarity, for the viewer to suggest."""
        self.conn = init_db()
        try:
            return self._assign(day, voices, prior)
        finally:
            self.conn.close()
            self.conn = None

    def _assign(self, day: str, voices: dict[str, tuple[np.ndarray, float]], prior: dict[str, str]) -> tuple[dict, dict]:
        cur = self.conn
        log = _state.log()
        # Re-transcribing a day replaces its voiceprints rather than counting it twice
        cur.execute("DELETE FROM voiceprints WHERE day = ?", (day,))
        people = self.people()
        names: dict[str, str] = {}
        taken: set[int] = set()

        for label, name in prior.items():
            spk_id = self._speaker_id(name)
            names[label] = name
            taken.add(spk_id)
            log(f"      {label}: kept earlier name '{name}'")

        # Every voice's closest known people, for suggestions in the viewer
        scores = {label: sorted(((self.score(emb, prints), spk_id) for spk_id, (_, prints) in people.items()), reverse=True)
                  for label, (emb, _) in voices.items()}
        info = {label: {"match": None, "candidates": [{"name": people[i][0], "score": round(sc, 3)}
                                                      for sc, i in scores[label][:4] if sc >= SUGGEST_THRESHOLD]}
                for label in voices}

        # Best matches first, one person per voice (two voices can't both be the same known person)
        pairs = sorted(((sc, label, spk_id) for label in voices if label not in names for sc, spk_id in scores[label]),
                       reverse=True)
        for score, label, spk_id in pairs:
            if label in names or spk_id in taken or score < MATCH_THRESHOLD:
                continue
            names[label] = people[spk_id][0]
            info[label]["match"] = round(score, 3)
            taken.add(spk_id)
            log(f"      {label}: matched '{names[label]}' (similarity {score:.2f})")

        unknown = 0
        for label in sorted(voices, key=lambda l: -voices[l][1]):
            if label in names:
                continue
            best = info[label]["candidates"][0] if info[label]["candidates"] else None
            if voices[label][1] < MIN_VOICE_SECONDS:
                # Too little speech for a trustworthy new voiceprint: don't invent a person from it.
                # Each still gets its own label so it can be named separately in the viewer.
                unknown += 1
                names[label] = f"Unknown voice {unknown}"
                log(f"      {label}: only {voices[label][1]:.0f}s of speech; left as Unknown"
                    + (f" (closest {best['name']} {best['score']:.2f})" if best else ""))
                continue
            names[label] = self._unique_name()
            self._speaker_id(names[label])
            log(f"      {label}: new voice '{names[label]}'" + (f" (closest {best['name']} {best['score']:.2f})" if best else ""))

        # Store today's voiceprints; keep only the most recent MAX_VOICEPRINTS per person
        now = time.time()
        for label, (emb, seconds) in voices.items():
            if names[label].startswith("Unknown"):
                continue
            spk_id = self._speaker_id(names[label])
            cur.execute("DELETE FROM voiceprints WHERE speaker_id = ? AND day = 'legacy'", (spk_id,))
            cur.execute("INSERT INTO voiceprints (speaker_id, embedding, seconds, day, created, label) VALUES (?, ?, ?, ?, ?, ?)",
                        (spk_id, unit(emb).tobytes(), seconds, day, now, label))
            cur.execute("""DELETE FROM voiceprints WHERE speaker_id = ? AND id NOT IN (
                               SELECT id FROM voiceprints WHERE speaker_id = ? ORDER BY created DESC LIMIT ?)""",
                        (spk_id, spk_id, MAX_VOICEPRINTS))
            cur.execute("UPDATE speakers SET sample_count = (SELECT COUNT(*) FROM voiceprints WHERE speaker_id = ?) "
                        "WHERE id = ?", (spk_id, spk_id))

        # Re-transcribing can leave behind people who no longer appear anywhere; forget them
        forget_unused_speakers(cur, keep=set(names.values()), skip_day=day)
        cur.commit()
        return names, info


def forget_unused_speakers(conn, keep: set[str] = frozenset(), skip_day: str | None = None):
    """Delete people with no voiceprints whose name no transcript uses."""
    in_use = set(keep)
    load = _state.load_transcript()
    for other, path in _state.all_transcripts()():
        if other != skip_day:
            in_use |= {s.get("speaker") for s in load(path).get("segments", [])}
    for spk_id, name in conn.execute("SELECT id, name FROM speakers s WHERE NOT EXISTS "
                                     "(SELECT 1 FROM voiceprints v WHERE v.speaker_id = s.id)").fetchall():
        if name not in in_use:
            conn.execute("DELETE FROM speakers WHERE id = ?", (spk_id,))
