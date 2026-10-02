"""Teaching voices from single lines, and re-naming a voice on one day."""
import json
import re
import time
import threading
import warnings

import numpy as np

from app_config import (MAX_VOICEPRINTS, MIN_TRAIN_LINE_SECONDS, LINE_MATCH_THRESHOLD,
                        LINE_MATCH_MARGIN, LINE_STRONG_MATCH, MAX_LINE_SUGGESTIONS)
from storage import init_db
from . import _state
from .memory import VoiceMemory, unit, forget_unused_speakers


class LineVoices:
    """Loads only the speaker-embedding model (small, ~2 s) on first use and embeds single lines of a day.
    Embeddings are cached per day until merged.wav changes."""

    def __init__(self):
        self.lock = threading.Lock()
        self.model = None
        self.torch = None
        self.cache: dict[str, tuple[float, dict]] = {}   # date -> (merged.wav mtime, {(start, end): unit emb})

    def _load(self):
        if self.model is None:
            import torch
            from pyannote.audio.pipelines.speaker_verification import PretrainedSpeakerEmbedding
            warnings.filterwarnings("ignore", message=".*torchcodec.*")
            self.torch = torch
            self.model = PretrainedSpeakerEmbedding(
                {"checkpoint": "pyannote/speaker-diarization-community-1", "subfolder": "embedding"},
                token=_state.hf_token(), device=torch.device("cuda" if torch.cuda.is_available() else "cpu"))

    def embed(self, date: str, spans: list[tuple[float, float]]) -> dict[tuple[float, float], np.ndarray]:
        """Unit embeddings for (start, end) spans of the day's merged.wav (seconds)."""
        from scipy.io import wavfile
        wav = _state.day_dir()(date) / "merged.wav"
        if not wav.is_file():
            raise FileNotFoundError(f"No merged audio for {date}; re-transcribe the day first")
        with self.lock:
            self._load()
            mtime = wav.stat().st_mtime
            if self.cache.get(date, (None,))[0] != mtime:
                self.cache[date] = (mtime, {})
            known = self.cache[date][1]
            sr, data = wavfile.read(wav, mmap=True)
            for a, b in spans:
                key = (round(a, 2), round(b, 2))
                if key in known:
                    continue
                piece = np.asarray(data[int(a * sr):int(b * sr)], np.float32) / 32768.0
                if len(piece) < sr // 2:
                    continue
                with self.torch.inference_mode():
                    known[key] = unit(self.model(self.torch.from_numpy(piece)[None, None, :])[0].astype(np.float32))
            return {(round(a, 2), round(b, 2)): known[(round(a, 2), round(b, 2))]
                    for a, b in spans if (round(a, 2), round(b, 2)) in known}


line_voices = LineVoices()


def teach_voice(date: str, old: str, new: str, labels: list[str] | None = None) -> tuple[list[str], bool]:
    """Naming a voice on a day also teaches it: that day's sample of the voice moves to `new`'s global
    profile, so future days recognise them. Other days' transcripts are not rewritten.
    Returns (voice labels changed, whether a sample was available to learn from)."""
    path = _state.transcript_path()(date)
    with _state.lock()():
        data = json.loads(path.read_text(encoding="utf-8"))
        targets = [v for v in data.get("voices", [])
                   if (v.get("label") in labels if labels is not None else v.get("name") == old)]
        for v in targets:
            v["name"] = new
            v["named"] = not re.match(r"(Unknown voice \d+|Speaker_\d+)$", new)   # undo back to an automatic name
            v.pop("tv", None)   # the TV endpoint sets it again after this
        if targets:
            _state.write_transcript()(path, data)
    conn = init_db()
    learned = False
    try:
        old_row = conn.execute("SELECT id FROM speakers WHERE name = ?", (old,)).fetchone()
        new_id = None
        if not new.startswith("Unknown"):
            row = conn.execute("SELECT id FROM speakers WHERE name = ?", (new,)).fetchone()
            new_id = row[0] if row else conn.execute("INSERT INTO speakers (name, sample_count) VALUES (?, 0)", (new,)).lastrowid
        now = time.time()
        for v in targets:
            emb = v.get("embedding")
            if emb:
                # Replace whatever this voice left on this day (under any name) with a print for `new`
                conn.execute("DELETE FROM voiceprints WHERE day = ? AND label = ?", (date, v["label"]))
                if new_id:
                    conn.execute("INSERT INTO voiceprints (speaker_id, embedding, seconds, day, created, label) "
                                 "VALUES (?, ?, ?, ?, ?, ?)",
                                 (new_id, unit(np.array(emb, np.float32)).tobytes(), v.get("seconds", 0), date, now, v["label"]))
                    learned = True
            elif old_row and new_id:
                # Older transcript without samples: move the day's print the old name had, if any
                learned = conn.execute("UPDATE voiceprints SET speaker_id = ? WHERE speaker_id = ? AND day = ?",
                                       (new_id, old_row[0], date)).rowcount > 0 or learned
        for spk in {new_id, old_row[0] if old_row else None} - {None}:
            conn.execute("""DELETE FROM voiceprints WHERE speaker_id = ? AND id NOT IN (
                                SELECT id FROM voiceprints WHERE speaker_id = ? ORDER BY created DESC LIMIT ?)""",
                         (spk, spk, MAX_VOICEPRINTS))
            conn.execute("UPDATE speakers SET sample_count = (SELECT COUNT(*) FROM voiceprints WHERE speaker_id = ?) "
                         "WHERE id = ?", (spk, spk))
        forget_unused_speakers(conn, keep={new})
        conn.commit()
    finally:
        conn.close()
    return [v["label"] for v in targets], learned


def _same_line(a: dict, b: dict) -> bool:
    return abs(a["start"] - b["start"]) < 0.02 and a["text"] == b["text"]


def _store_line_print(conn, date: str, person: str, entries: list[dict]):
    """One voiceprint per person per day built from their taught lines (mean of the line embeddings,
    weighted by length), under label 'lines', so many short lines don't crowd out other days' prints."""
    row = conn.execute("SELECT id FROM speakers WHERE name = ?", (person,)).fetchone()
    spk_id = row[0] if row else conn.execute("INSERT INTO speakers (name, sample_count) VALUES (?, 0)", (person,)).lastrowid
    conn.execute("DELETE FROM voiceprints WHERE speaker_id = ? AND day = ? AND label = 'lines'", (spk_id, date))
    if entries:
        w = np.array([e["seconds"] for e in entries], np.float32)
        emb = unit((np.array([e["embedding"] for e in entries], np.float32) * w[:, None]).sum(0))
        conn.execute("DELETE FROM voiceprints WHERE speaker_id = ? AND day = 'legacy'", (spk_id,))
        conn.execute("INSERT INTO voiceprints (speaker_id, embedding, seconds, day, created, label) "
                     "VALUES (?, ?, ?, ?, ?, 'lines')", (spk_id, emb.tobytes(), float(w.sum()), date, time.time()))
    conn.execute("""DELETE FROM voiceprints WHERE speaker_id = ? AND id NOT IN (
                        SELECT id FROM voiceprints WHERE speaker_id = ? ORDER BY created DESC LIMIT ?)""",
                 (spk_id, spk_id, MAX_VOICEPRINTS))
    conn.execute("UPDATE speakers SET sample_count = (SELECT COUNT(*) FROM voiceprints WHERE speaker_id = ?) "
                 "WHERE id = ?", (spk_id, spk_id))


def restore_line_prints(date: str, prints: list[dict]):
    """Re-store the 'lines' voiceprints of a day (after re-transcribing wiped the day's prints)."""
    conn = init_db()
    try:
        for who in {p["person"] for p in prints}:
            _store_line_print(conn, date, who, [p for p in prints if p["person"] == who])
        conn.commit()
    finally:
        conn.close()


def train_lines(date: str, person: str, lines: list[dict], remove: bool = False) -> dict:
    """Teach (or, with remove=True, un-teach) `person`'s voice from specific lines of a day.
    Taught lines are kept in the transcript's `line_prints`, so the day's 'lines' voiceprint can be rebuilt.
    Lines under MIN_TRAIN_LINE_SECONDS or with someone talking over them are skipped."""
    if person.startswith("Unknown"):
        raise ValueError("Give the voice a name before teaching it")
    path = _state.transcript_path()(date)
    skipped, todo = [], []
    if not remove:
        with _state.lock()():
            segs = json.loads(path.read_text(encoding="utf-8")).get("segments", [])
        for l in lines:
            seg = next((s for s in segs if _same_line(s, l)), None)
            if not seg:
                skipped.append({**l, "why": "line not found"})
            elif seg["end"] - seg["start"] < MIN_TRAIN_LINE_SECONDS:
                skipped.append({**l, "why": "too short"})
            elif seg.get("overlap") or seg.get("overlap_labels"):
                skipped.append({**l, "why": "someone talks over it"})
            else:
                todo.append(seg)
        embs = line_voices.embed(date, [(s["start"], s["end"]) for s in todo])
    with _state.lock()():
        data = json.loads(path.read_text(encoding="utf-8"))
        prints = [p for p in data.get("line_prints", []) if not any(_same_line(p, l) for l in (lines if remove else todo))]
        added = []
        for s in [] if remove else todo:
            e = embs.get((round(s["start"], 2), round(s["end"], 2)))
            if e is None:
                skipped.append({"start": s["start"], "text": s["text"], "why": "no audio"})
                continue
            p = {"start": s["start"], "text": s["text"], "person": person, "seconds": round(s["end"] - s["start"], 2),
                 "embedding": [round(float(x), 5) for x in e]}
            prints.append(p)
            added.append(p)
        touched = {person} | {p["person"] for p in data.get("line_prints", []) if p not in prints}
        data["line_prints"] = prints
        _state.write_transcript()(path, data)
    conn = init_db()
    try:
        for who in touched:
            _store_line_print(conn, date, who, [p for p in prints if p["person"] == who])
        forget_unused_speakers(conn, keep={person})
        conn.commit()
    finally:
        conn.close()
    return {"trained": [{"start": p["start"], "text": p["text"]} for p in added], "skipped": skipped}


def similar_lines(date: str, person: str) -> list[dict]:
    """Lines of the day (not already `person`'s) whose voice matches `person`'s profile, best first."""
    conn = init_db()
    try:
        mem = VoiceMemory(); mem.conn = conn
        people = {name: prints for name, prints in mem.people().values()}
    finally:
        conn.close()
    if person not in people:
        return []
    data = _state.load_transcript()(_state.transcript_path()(date))
    cand = [s for s in data.get("segments", [])
            if s.get("speaker") != person and not s.get("noise") and not s.get("overlap")
            and s["end"] - s["start"] >= MIN_TRAIN_LINE_SECONDS]
    embs = line_voices.embed(date, [(s["start"], s["end"]) for s in cand])
    out = []
    for s in cand:
        e = embs.get((round(s["start"], 2), round(s["end"], 2)))
        if e is None:
            continue
        mine = VoiceMemory.score(e, people[person])
        theirs = VoiceMemory.score(e, people[s["speaker"]]) if s["speaker"] in people else 0.0
        if mine >= LINE_MATCH_THRESHOLD and mine >= theirs + LINE_MATCH_MARGIN:
            out.append({"start": s["start"], "end": s["end"], "text": s["text"], "speaker": s["speaker"],
                        "score": round(mine, 3), "current_score": round(theirs, 3),
                        "strong": mine >= LINE_STRONG_MATCH})
    return sorted(out, key=lambda x: -x["score"])[:MAX_LINE_SUGGESTIONS]
