"""
Voice recorder ingest: merges each day's recordings, transcribes them with WhisperX,
diarizes speakers and matches voices against a persistent speaker database.

Usage:
    python app.py                         # process any new days, then open the viewer
    python app.py --serve                 # just open the viewer (you can transcribe days from it)
    python app.py --no-serve              # just process
    python app.py --force                 # re-transcribe every day
    python app.py --speakers              # list known speakers
    python app.py --rename Speaker_1 Alice   # give a known voice a real name

The viewer runs at http://localhost:5000 (change with --port / --host).
"""
import os
import re
import sys
import json
import time
import shutil
import sqlite3
import argparse
import threading
import subprocess
import warnings
from pathlib import Path

import numpy as np
from dotenv import load_dotenv

load_dotenv()

# We always hand pyannote in-memory audio, so its torchcodec file decoder is never used.
warnings.filterwarnings("ignore", message=r"(?s).*torchcodec is not installed correctly")

# --- CONFIGURATION ---
SCRIPT_DIR = Path(__file__).resolve().parent
INPUT_DIR = Path(os.getenv("RECORD_DIR", SCRIPT_DIR.parent / "RECORD"))          # Your voice recorder mount
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", SCRIPT_DIR / "processed_daily"))
DB_PATH = Path(os.getenv("SPEAKER_DB", SCRIPT_DIR / "speaker_memory.db"))
HF_TOKEN = os.getenv("HF_TOKEN")   # HuggingFace token for pyannote models
LANGUAGE = os.getenv("LANGUAGE") or None  # e.g. "en"; unset = auto-detect from the first 30s
MIN_RECORDING_SECONDS = 3.0        # Skip accidental taps / clicks

# Speaker detection. Voiceprints are the diarization pipeline's own per-speaker centroids
# (wespeaker embeddings averaged over each speaker's clean, non-overlapping speech).
CLUSTER_THRESHOLD = 0.6            # pyannote VBx clustering; lower = splits voices more eagerly
SAME_PERSON_THRESHOLD = 0.75       # Two of today's clusters this similar are one person, re-joined
MATCH_THRESHOLD = 0.55             # Similarity needed to say "this is a known person" from another day
MAX_VOICEPRINTS = 40               # Stored voiceprints kept per person (oldest dropped)

# Whisper voice-activity detection: lower = picks up quieter / more distant speech
VAD_ONSET = 0.35
VAD_OFFSET = 0.25
SAMPLE_RATE = 16000
GATED_MODELS = ["pyannote/speaker-diarization-community-1"]

# V2026-08-20-06-18-54.MP3 / .WAV -> date 2026-08-20, recorded at 06:18:54
FILE_PATTERN = re.compile(r"^V(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2}).*\.(mp3|wav)$", re.IGNORECASE)
RECORDING_SUFFIXES = {".mp3", ".wav"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Share of a day's processing time each step takes, used for the overall progress bar
STEPS = [("merge", "Merging & cleaning audio", 5), ("transcribe", "Transcribing", 55),
         ("align", "Aligning words", 10), ("diarize", "Identifying speakers", 25),
         ("save", "Matching voices & saving", 5)]


def log(msg: str):
    print(msg, flush=True)


# --- DATABASE SETUP ---
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS speakers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            embedding BLOB,
            sample_count INTEGER DEFAULT 1
        );
        -- Several voiceprints per person (one per day they were heard), so matching
        -- copes with different rooms, mics and moods instead of one blurred average.
        CREATE TABLE IF NOT EXISTS voiceprints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            speaker_id INTEGER NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
            embedding BLOB NOT NULL,
            seconds REAL,
            day TEXT,
            created REAL
        );
    """)
    # Older databases kept a single averaged embedding per speaker; keep it as a 'legacy' print
    conn.execute("""
        INSERT INTO voiceprints (speaker_id, embedding, seconds, day, created)
        SELECT id, embedding, 0, 'legacy', 0 FROM speakers s
        WHERE embedding IS NOT NULL AND NOT EXISTS (SELECT 1 FROM voiceprints v WHERE v.speaker_id = s.id)
    """)
    conn.commit()
    return conn


# --- AUDIO PRE-PROCESSING ---
def get_daily_batches(input_dir: Path) -> dict[str, list[Path]]:
    batches = {}
    if not input_dir.is_dir():
        return batches
    # Sort by the timestamp in the name so MP3 and WAV recordings from one day interleave correctly
    files = sorted((f for f in input_dir.iterdir() if FILE_PATTERN.match(f.name) and f.is_file()),
                   key=lambda f: f.stem.upper())
    for file in files:
        if probe_duration(file) < MIN_RECORDING_SECONDS:
            continue
        batches.setdefault(FILE_PATTERN.match(file.name).group(1), []).append(file)
    return batches


def recorded_at(name: str) -> str | None:
    """Wall-clock time a recording started, from its filename (HH:MM:SS)."""
    m = FILE_PATTERN.match(name)
    return f"{m.group(2)}:{m.group(3)}:{m.group(4)}" if m else None


_duration_cache: dict[tuple[str, float], float] = {}


def probe_duration(path: Path) -> float:
    key = (str(path), path.stat().st_mtime)
    if key not in _duration_cache:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True)
        try:
            _duration_cache[key] = float(out.stdout.strip())
        except ValueError:
            _duration_cache[key] = 0.0
    return _duration_cache[key]


def describe_sources(files: list[Path]) -> list[dict]:
    """Where each recording sits inside the merged day audio."""
    sources, offset = [], 0.0
    for f in files:
        dur = probe_duration(f) if f.exists() else 0.0
        sources.append({"name": f.name, "start": round(offset, 2), "duration": round(dur, 2),
                        "recorded_at": recorded_at(f.name), "bytes": f.stat().st_size if f.exists() else None})
        offset += dur
    return sources


def prepare_daily_audio(date_str: str, file_list: list[Path]) -> Path:
    merged_path = OUTPUT_DIR / f"{date_str}_merged.wav"
    # Sidecar records which recordings the WAV was built from, so new recordings trigger a rebuild
    manifest = OUTPUT_DIR / f"{date_str}_merged.sources.json"
    names = [f.name for f in file_list]
    if merged_path.exists() and manifest.exists():
        try:
            if json.loads(manifest.read_text(encoding="utf-8")) == names:
                return merged_path
        except (OSError, json.JSONDecodeError):
            pass

    # Decode every recording through the concat *filter* (not the concat demuxer), so a day can mix
    # MP3s with the recorder's 48 kHz stereo WAVs. Then: highpass + gentle level normalisation.
    n = len(file_list)
    graph = "".join(f"[{i}:a]aresample={SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=mono[a{i}];"
                    for i in range(n))
    graph += "".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1,highpass=f=80,speechnorm=e=4:r=0.0001:l=1[out]"
    inputs = [arg for f in file_list for arg in ("-i", str(f))]

    # Write to a temp file so an interrupted run never leaves a truncated "finished" WAV behind.
    tmp_path = merged_path.with_suffix(".tmp.wav")
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs,
        "-filter_complex", graph, "-map", "[out]",
        "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le",
        str(tmp_path),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg failed merging {date_str}:\n{proc.stderr.strip()}")
        tmp_path.replace(merged_path)
        manifest.write_text(json.dumps(names), encoding="utf-8")
    finally:
        tmp_path.unlink(missing_ok=True)
    return merged_path


# --- SPEAKER PROFILE MATCHER ---
def unit(v) -> np.ndarray:
    v = np.asarray(v, dtype=np.float32).flatten()
    return v / (np.linalg.norm(v) or 1.0)


class VoiceMemory:
    """Remembers people across days. Each person has several voiceprints (one per day heard)."""

    def __init__(self, conn):
        self.conn = conn

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

    def assign(self, day: str, voices: dict[str, tuple[np.ndarray, float]], prior: dict[str, str]) -> dict[str, str]:
        """Name today's voices. `voices` maps label -> (embedding, seconds spoken); `prior` maps
        label -> name kept from an earlier transcript of this same day (so renames survive)."""
        cur = self.conn
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

        # Best matches first, one person per voice (two voices can't both be the same known person)
        pairs = sorted(((self.score(emb, prints), label, spk_id)
                        for label, (emb, _) in voices.items() if label not in names
                        for spk_id, (_, prints) in people.items()), reverse=True)
        for score, label, spk_id in pairs:
            if label in names or spk_id in taken or score < MATCH_THRESHOLD:
                continue
            names[label] = people[spk_id][0]
            taken.add(spk_id)
            log(f"      {label}: matched '{names[label]}' (similarity {score:.2f})")

        for label in sorted(voices, key=lambda l: -voices[l][1]):
            if label not in names:
                best = max((s for s, l, _ in pairs if l == label), default=None)
                names[label] = self._unique_name()
                self._speaker_id(names[label])
                log(f"      {label}: new voice '{names[label]}'" + (f" (closest known {best:.2f})" if best else ""))

        # Store today's voiceprints; keep only the most recent MAX_VOICEPRINTS per person
        now = time.time()
        for label, (emb, seconds) in voices.items():
            spk_id = self._speaker_id(names[label])
            cur.execute("DELETE FROM voiceprints WHERE speaker_id = ? AND day = 'legacy'", (spk_id,))
            cur.execute("INSERT INTO voiceprints (speaker_id, embedding, seconds, day, created) VALUES (?, ?, ?, ?, ?)",
                        (spk_id, unit(emb).tobytes(), seconds, day, now))
            cur.execute("""DELETE FROM voiceprints WHERE speaker_id = ? AND id NOT IN (
                               SELECT id FROM voiceprints WHERE speaker_id = ? ORDER BY created DESC LIMIT ?)""",
                        (spk_id, spk_id, MAX_VOICEPRINTS))
            cur.execute("UPDATE speakers SET sample_count = (SELECT COUNT(*) FROM voiceprints WHERE speaker_id = ?) "
                        "WHERE id = ?", (spk_id, spk_id))

        # Re-transcribing can leave behind people who no longer appear anywhere; forget them
        in_use = set(names.values())
        for path in OUTPUT_DIR.glob("*_transcript.json"):
            if path.name != f"{day}_transcript.json":
                in_use |= {s.get("speaker") for s in load_transcript(path).get("segments", [])}
        for spk_id, name in cur.execute("SELECT id, name FROM speakers s WHERE NOT EXISTS "
                                        "(SELECT 1 FROM voiceprints v WHERE v.speaker_id = s.id)").fetchall():
            if name not in in_use:
                cur.execute("DELETE FROM speakers WHERE id = ?", (spk_id,))
        cur.commit()
        return names


# --- MAIN INGEST PIPELINE ---
def setup_problems() -> list[str]:
    problems = []
    if not INPUT_DIR.is_dir():
        problems.append(f"Recordings folder not found: {INPUT_DIR}  (set RECORD_DIR to override)")
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        problems.append("ffmpeg is not on PATH. Install it (e.g. `winget install Gyan.FFmpeg`) and reopen your terminal.")
    if not HF_TOKEN:
        problems.append("HF_TOKEN is not set. Create a token at https://huggingface.co/settings/tokens, accept the "
                        "pyannote model terms, then put  HF_TOKEN=hf_...  in a .env file (see .env.example).")
    return problems


def model_access_problems() -> list[str]:
    """Check up front that the HF token can read the gated pyannote models."""
    from huggingface_hub import HfApi
    from huggingface_hub.errors import GatedRepoError, HfHubHTTPError

    api = HfApi()
    problems = []
    for repo in GATED_MODELS:
        try:
            api.auth_check(repo, token=HF_TOKEN)
        except GatedRepoError:
            problems.append(f"Accept the user conditions at https://huggingface.co/{repo} (log in, click 'Agree').")
        except HfHubHTTPError as e:
            status = getattr(e.response, "status_code", None)
            if status == 401:
                problems.append("HF_TOKEN is invalid or expired. Create a new one at https://huggingface.co/settings/tokens")
                break
            if status == 403:
                problems.append(
                    "Your HF token is fine-grained and can't read gated repos. At "
                    "https://huggingface.co/settings/tokens edit the token and tick "
                    "'Read access to contents of all public gated repos you can access' "
                    "(or create a classic 'Read' token instead).")
                break
            problems.append(f"Couldn't check {repo}: {e}")
        except Exception as e:
            log(f"(Skipping Hugging Face access check: {e})")
            return []
    return list(dict.fromkeys(problems))


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
    changes, ignoring 1-2 word blips at the boundary (usually timing jitter)."""
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
                runs.append({"speaker": spk, "words": [], "start": None, "end": None})
            r = runs[-1]
            r["words"].append(str(w["word"]).strip())
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
            tiny = len(r["words"]) <= 2 and r["end"] - r["start"] < 0.6
            if merged and (tiny or merged[-1]["speaker"] == r["speaker"]):
                merged[-1]["words"] += r["words"]
                merged[-1]["end"] = max(merged[-1]["end"], r["end"])
            else:
                merged.append(r)
        if len(merged) > 1 and len(merged[0]["words"]) <= 2 and merged[0]["end"] - merged[0]["start"] < 0.6:
            first = merged.pop(0)
            merged[0]["words"] = first["words"] + merged[0]["words"]
            merged[0]["start"] = first["start"]
        for r in merged:
            lines.append({"start": r["start"], "end": r["end"], "speaker": r["speaker"],
                          "text": joiner.join(r["words"])})
    return lines


def names_from_previous(turns: list[tuple[float, float, str]], old_segments: list[dict]) -> dict[str, str]:
    """When re-transcribing a day, carry over the names from the old transcript (so renames like
    'Kenzie' survive) for voices that clearly line up with the same stretches of speech."""
    import bisect
    old = sorted((s["start"], s["end"], s["speaker"]) for s in old_segments
                 if s.get("speaker") and s["speaker"] != "Unknown")
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


class Engine:
    """Loaded models, reused across days (loading takes a while)."""

    def __init__(self):
        import torch
        import whisperx
        from whisperx.diarize import DiarizationPipeline

        self.torch, self.whisperx = torch, whisperx
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type = "float16" if self.device == "cuda" else "int8"
        log(f"Loading models on {self.device.upper()} (first run downloads several GB)...")
        self.memory = VoiceMemory(init_db())
        self.whisper_model = whisperx.load_model(
            "large-v3", self.device, compute_type=compute_type, language=LANGUAGE,
            vad_options={"vad_onset": VAD_ONSET, "vad_offset": VAD_OFFSET})
        self.diarize_model = DiarizationPipeline(token=HF_TOKEN, device=self.device)
        # Cluster more eagerly so quiet / brief speakers get their own voice; near-identical
        # clusters are joined again afterwards by same_person_groups().
        params = self.diarize_model.model.parameters(instantiated=True)
        params["clustering"]["threshold"] = CLUSTER_THRESHOLD
        self.diarize_model.model.instantiate(params)

    def process_day(self, date_key: str, files: list[Path], progress=None, hint: dict | None = None) -> Path:
        """Transcribe one day. `progress(fraction, label)` is called as work advances.
        `hint` may hold num_speakers, or min_speakers / max_speakers, to guide speaker detection."""
        torch, whisperx = self.torch, self.whisperx
        weights = {key: w for key, _, w in STEPS}
        total = sum(weights.values())
        done = {"w": 0}

        json_out = OUTPUT_DIR / f"{date_key}_transcript.json"
        previous = load_transcript(json_out) if json_out.exists() else None
        if hint is None:  # re-transcribing remembers the hint given last time
            hint = (previous or {}).get("speaker_hint") or {}
        hint = {k: int(v) for k, v in hint.items() if k in ("num_speakers", "min_speakers", "max_speakers") and v}

        def step(key: str):
            label = next(l for k, l, _ in STEPS if k == key)
            idx = [k for k, _, _ in STEPS].index(key) + 1
            log(f"  {idx}/{len(STEPS)} {label}...")

            def report(pct: float = 0.0):
                if progress:
                    progress((done["w"] + weights[key] * min(pct, 100) / 100) / total, label)
            report(0)
            return report

        def finish(key: str):
            done["w"] += weights[key]

        try:
            report = step("merge")
            audio_file = prepare_daily_audio(date_key, files)
            audio = whisperx.load_audio(str(audio_file))
            finish("merge")

            report = step("transcribe")
            result = self.whisper_model.transcribe(audio, batch_size=16, language=LANGUAGE, progress_callback=report)
            language = result["language"]
            finish("transcribe")

            report = step("align")
            align_model, metadata = whisperx.load_align_model(language_code=language, device=self.device)
            result = whisperx.align(result["segments"], align_model, metadata, audio, self.device,
                                    return_char_alignments=False, progress_callback=report)
            del align_model
            finish("align")

            report = step("diarize")
            if hint:
                log(f"      speaker hint: {hint}")
            diarize_df, raw_emb = self.diarize_model(audio, return_embeddings=True, progress_callback=report, **hint)
            finish("diarize")

            report = step("save")
            seconds = (diarize_df.end - diarize_df.start).groupby(diarize_df.speaker).sum().to_dict()
            emb = {l: unit(v) for l, v in (raw_emb or {}).items() if np.all(np.isfinite(v)) and l in seconds}
            # An exact speaker count is the user's call; otherwise join clusters that are the same voice
            if "num_speakers" in hint:
                rep = {l: l for l in emb}
            else:
                rep = same_person_groups(emb, SAME_PERSON_THRESHOLD, hint.get("min_speakers", 0))
            diarize_df["speaker"] = diarize_df["speaker"].map(lambda l: rep.get(l, l))
            voices: dict[str, tuple[np.ndarray, float]] = {}
            for label in set(rep.values()):
                members = [l for l in rep if rep[l] == label]
                secs = sum(seconds[m] for m in members)
                voices[label] = (unit(sum(emb[m] * seconds[m] for m in members)), secs)

            result = whisperx.assign_word_speakers(diarize_df, result, fill_nearest=True)
            lines = split_by_speaker(result["segments"], language)

            turns = list(zip(diarize_df.start, diarize_df.end, diarize_df.speaker))
            prior = names_from_previous(turns, previous["segments"]) if previous else {}
            prior = {l: n for l, n in prior.items() if l in voices}
            names = self.memory.assign(date_key, voices, prior)

            timeline = [{
                "start": round(line["start"], 2),
                "end": round(line["end"], 2),
                "speaker": names.get(line["speaker"], "Unknown"),
                "text": line["text"],
            } for line in lines if line["text"].strip()]

            tmp_out = json_out.with_suffix(".tmp")
            tmp_out.write_text(json.dumps({
                "date": date_key,
                "language": language,
                "audio": audio_file.name,
                "speaker_hint": hint,
                "sources": describe_sources(files),
                "segments": timeline,
            }, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp_out.replace(json_out)
            finish("save")
            if progress:
                progress(1.0, "Done")
            log(f"  Done -> {json_out}  ({len(set(names.values()))} speakers, {len(timeline)} lines)")
            return json_out
        finally:
            if self.device == "cuda":
                torch.cuda.empty_cache()


def needs_processing(date_key: str, files: list[Path]) -> bool:
    """True if the day has no transcript, or recordings were added/changed since it was made."""
    path = OUTPUT_DIR / f"{date_key}_transcript.json"
    if not path.exists():
        return True
    data = load_transcript(path)
    if {f.name for f in files} - set(transcript_source_names(data)):
        return True
    # A recording that was still being copied when the day was transcribed has since grown
    sizes = {s["name"]: s.get("bytes") for s in data.get("sources", []) if isinstance(s, dict)}
    return any(sizes.get(f.name) not in (None, f.stat().st_size) for f in files)


def process_all(force: bool = False, hint: dict | None = None):
    problems = setup_problems()
    if problems:
        log("Cannot start:\n  - " + "\n  - ".join(problems))
        sys.exit(1)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    batches = get_daily_batches(INPUT_DIR)
    if not force:
        batches = {d: f for d, f in batches.items() if needs_processing(d, f)}
    if not batches:
        log(f"Nothing new to process in {INPUT_DIR}. (Use --force to redo existing days.)")
        return

    log(f"Found {len(batches)} day(s) to process: {', '.join(batches)}")
    problems = model_access_problems()
    if problems:
        log("Hugging Face model access problem:\n  - " + "\n  - ".join(problems))
        sys.exit(1)

    engine = Engine()
    for n, (date_key, files) in enumerate(batches.items(), 1):
        log(f"\n[{n}/{len(batches)}] {date_key} - {len(files)} recording(s)")
        try:
            engine.process_day(date_key, files, hint=hint)
        except Exception as e:
            log(f"  FAILED: {e}")

    log(f"\nAll done. Transcripts are in {OUTPUT_DIR}")


# --- TRANSCRIPT HELPERS ---
_transcript_cache: dict[str, tuple[float, dict]] = {}


def load_transcript(path: Path) -> dict:
    mtime = path.stat().st_mtime
    cached = _transcript_cache.get(str(path))
    if cached and cached[0] == mtime:
        return cached[1]
    data = json.loads(path.read_text(encoding="utf-8"))
    _transcript_cache[str(path)] = (mtime, data)
    return data


def transcript_source_names(data: dict) -> list[str]:
    return [s["name"] if isinstance(s, dict) else s for s in data.get("sources", [])]


def transcript_sources(data: dict) -> list[dict]:
    """Source recordings with offsets; older transcripts only stored filenames."""
    sources = data.get("sources", [])
    if all(isinstance(s, dict) for s in sources):
        return sources
    return describe_sources([INPUT_DIR / name for name in transcript_source_names(data)])


# --- SPEAKER MANAGEMENT ---
def list_speakers():
    conn = init_db()
    rows = conn.execute("SELECT id, name, sample_count FROM speakers ORDER BY id").fetchall()
    if not rows:
        log("No speakers enrolled yet.")
        return
    log(f"{'ID':>4}  {'Name':<24} Samples")
    for spk_id, name, count in rows:
        log(f"{spk_id:>4}  {name:<24} {count}")


class RenameError(ValueError):
    pass


class NameTaken(RenameError):
    """The new name belongs to someone else; pass merge=True to make them one person."""


def rename_speaker_core(old: str, new: str, merge: bool = False) -> int:
    """Rename a speaker in the voice DB and every transcript. If `new` is an existing person and
    `merge` is set, the two become one: voiceprints are pooled and every line moves to `new`.
    Returns the number of transcripts changed."""
    new = new.strip()
    if not new:
        raise RenameError("The new name can't be empty.")
    if new == old:
        return 0
    conn = init_db()
    old_row = conn.execute("SELECT id FROM speakers WHERE name = ?", (old,)).fetchone()
    new_row = conn.execute("SELECT id FROM speakers WHERE name = ?", (new,)).fetchone()
    in_transcripts = {p: load_transcript(p) for p in OUTPUT_DIR.glob("*_transcript.json")}
    target_in_use = new_row or any(s.get("speaker") == new for d in in_transcripts.values() for s in d.get("segments", []))
    if target_in_use and not merge:
        raise NameTaken(f"'{new}' is already someone else. Merge '{old}' into '{new}'?")

    if old_row and new_row:
        conn.execute("UPDATE voiceprints SET speaker_id = ? WHERE speaker_id = ?", (new_row[0], old_row[0]))
        conn.execute("DELETE FROM speakers WHERE id = ?", (old_row[0],))
        conn.execute("UPDATE speakers SET sample_count = (SELECT COUNT(*) FROM voiceprints WHERE speaker_id = ?) "
                     "WHERE id = ?", (new_row[0], new_row[0]))
    elif old_row:
        conn.execute("UPDATE speakers SET name = ? WHERE id = ?", (new, old_row[0]))

    # Update existing transcripts too, so old days show the new name
    pending = []
    for path, data in in_transcripts.items():
        data = json.loads(json.dumps(data))  # don't mutate the cached copy
        changed = False
        for seg in data.get("segments", []):
            if seg.get("speaker") == old:
                seg["speaker"] = new
                changed = True
        if changed:
            pending.append((path, data))

    if not old_row and not pending:
        conn.rollback()
        raise RenameError(f"No speaker named '{old}'. Run with --speakers to see the list.")
    conn.commit()
    for path, data in pending:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return len(pending)


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


# --- BACKGROUND PROCESSING (for the viewer) ---
class Processor:
    """Single worker thread that transcribes days queued from the viewer, one at a time."""

    def __init__(self):
        self.lock = threading.Lock()
        self.queue: list[str] = []
        self.hints: dict[str, dict | None] = {}
        self.current: dict | None = None    # {"date", "progress", "label", "started"}
        self.errors: dict[str, str] = {}
        self.engine: Engine | None = None
        self.thread: threading.Thread | None = None
        self.failed_state: dict[str, tuple] = {}   # date -> recordings snapshot when it failed

    def summary(self) -> dict:
        with self.lock:
            cur = self.current and {k: self.current[k] for k in ("date", "progress", "label")}
            return {"current": cur, "queued": list(self.queue)}

    def watch(self, interval: float = 30.0, settle: float = 60.0, force: bool = False):
        """Keep an eye on the recordings folder and queue any day that is new or incomplete.
        Days whose files changed in the last `settle` seconds are left alone (still copying)."""
        def snapshot(files):
            return tuple((f.name, f.stat().st_size) for f in files)

        def loop():
            first = True
            while True:
                try:
                    now = time.time()
                    for date, files in sorted(get_daily_batches(INPUT_DIR).items()):
                        if any(now - f.stat().st_mtime < settle for f in files):
                            continue
                        # A day that failed is retried only once its recordings change (or from the UI)
                        if self.failed_state.get(date) == snapshot(files):
                            continue
                        if (first and force) or needs_processing(date, files):
                            self.enqueue(date)
                except Exception as e:
                    log(f"(watcher: {e})")
                first = False
                time.sleep(interval)

        threading.Thread(target=loop, daemon=True, name="record-watcher").start()

    def enqueue(self, date: str, hint: dict | None = None):
        with self.lock:
            if date in self.queue or (self.current and self.current["date"] == date):
                return
            self.errors.pop(date, None)
            self.failed_state.pop(date, None)
            self.hints[date] = hint
            self.queue.append(date)
            if not self.thread or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._run, daemon=True)
                self.thread.start()

    def cancel(self, date: str) -> bool:
        with self.lock:
            if date in self.queue:
                self.queue.remove(date)
                return True
        return False

    def state_for(self, date: str) -> dict | None:
        with self.lock:
            if self.current and self.current["date"] == date:
                return {"status": "processing", "progress": round(self.current["progress"], 3),
                        "label": self.current["label"]}
            if date in self.queue:
                return {"status": "queued", "position": self.queue.index(date) + 1}
            if date in self.errors:
                return {"status": "failed", "error": self.errors[date]}
        return None

    def _set(self, **kw):
        with self.lock:
            if self.current:
                self.current.update(kw)

    def _run(self):
        while True:
            with self.lock:
                if not self.queue:
                    self.current = None
                    return
                date = self.queue.pop(0)
                hint = self.hints.pop(date, None)
                self.current = {"date": date, "progress": 0.0, "label": "Starting", "started": time.time()}
            try:
                problems = setup_problems()
                if not problems and self.engine is None:
                    self._set(label="Checking model access")
                    problems = model_access_problems()
                if problems:
                    raise RuntimeError(" ".join(problems))
                files = get_daily_batches(INPUT_DIR).get(date)
                if not files:
                    raise RuntimeError(f"No recordings for {date} in {INPUT_DIR}")
                OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                if self.engine is None:
                    self._set(label="Loading models (first time can take several minutes)")
                    self.engine = Engine()
                log(f"\n[viewer] Processing {date} - {len(files)} recording(s)")
                self.engine.process_day(date, files, hint=hint,
                                        progress=lambda p, label: self._set(progress=p, label=label))
            except Exception as e:
                log(f"  FAILED: {e}")
                with self.lock:
                    self.errors[date] = str(e)
                    files = get_daily_batches(INPUT_DIR).get(date, [])
                    self.failed_state[date] = tuple((f.name, f.stat().st_size) for f in files)


# --- WEB VIEWER ---
def create_app(auto_process: bool = False, force: bool = False):
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import FileResponse
    from pydantic import BaseModel

    app = FastAPI(title="Recorder Playback", docs_url=None, redoc_url=None)
    processor = Processor()
    if auto_process:
        processor.watch(force=force)

    class RenameBody(BaseModel):
        old: str
        new: str
        merge: bool = False

    class ProcessBody(BaseModel):
        # None = reuse the day's previous hint; {} = let it decide automatically
        hint: dict | None = None

    def check_date(date: str):
        if not DATE_RE.match(date):
            raise HTTPException(404, "Unknown day")

    def safe_file(folder: Path, name: str, suffixes: set[str]) -> Path:
        # Only serve plain filenames that live directly inside `folder`
        path = (folder / name).resolve()
        if path.parent != folder.resolve() or not path.is_file() or path.suffix.lower() not in suffixes:
            raise HTTPException(404, "File not found")
        return path

    @app.get("/")
    def index():
        return FileResponse(SCRIPT_DIR / "viewer.html", headers={"Cache-Control": "no-cache"})

    @app.get("/api/library")
    def library():
        batches = get_daily_batches(INPUT_DIR)
        transcripts = {p.name.removesuffix("_transcript.json"): p
                       for p in OUTPUT_DIR.glob("*_transcript.json")} if OUTPUT_DIR.is_dir() else {}
        days = []
        for date in sorted(set(batches) | set(transcripts), reverse=True):
            if not DATE_RE.match(date):
                continue
            files = batches.get(date, [])
            day = {"date": date, "recordings": len(files), "status": "pending", "new_recordings": 0}
            if date in transcripts:
                try:
                    data = load_transcript(transcripts[date])
                except (OSError, json.JSONDecodeError):
                    data = None
                if data is not None:
                    segs = data.get("segments", [])
                    talk: dict[str, float] = {}
                    for s in segs:
                        talk[s.get("speaker")] = talk.get(s.get("speaker"), 0) + s["end"] - s["start"]
                    known = set(transcript_source_names(data))
                    src_total = sum(s.get("duration") or 0 for s in transcript_sources(data))
                    day.update({
                        "status": "ready",
                        "duration": round(src_total or (segs[-1]["end"] if segs else 0), 1),
                        "speakers": sorted(talk, key=talk.get, reverse=True),
                        "lines": len(segs),
                        "recordings": max(len(files), len(known)),
                        "new_recordings": len({f.name for f in files} - known),
                        "_source_names": list(known),
                    })
            if day["status"] == "pending":
                day["duration"] = round(sum(probe_duration(f) for f in files), 1)
            names = [f.name for f in files] + day.pop("_source_names", [])
            times = [t for t in map(recorded_at, names) if t]
            day["first_time"] = min(times) if times else None
            day["last_time"] = max(times) if times else None
            job = processor.state_for(date)
            if job:
                day["job"] = job
            days.append(day)
        jobs = processor.summary()
        return {"days": days, "record_dir": str(INPUT_DIR), "jobs": jobs, "auto_process": auto_process,
                "busy": bool(jobs["current"] or jobs["queued"])}

    @app.get("/api/days/{date}")
    def day(date: str):
        check_date(date)
        path = OUTPUT_DIR / f"{date}_transcript.json"
        if path.is_file():
            data = dict(load_transcript(path))
            audio = data.get("audio")
            data["audio_url"] = f"/audio/{audio}" if audio and (OUTPUT_DIR / audio).is_file() else None
            data["sources"] = transcript_sources(data)
            data["status"] = "ready"
        else:
            files = get_daily_batches(INPUT_DIR).get(date)
            if not files:
                raise HTTPException(404, f"Nothing recorded on {date}")
            data = {"date": date, "status": "pending", "segments": [], "audio_url": None,
                    "sources": describe_sources(files)}
        for s in data["sources"]:
            s["url"] = f"/recordings/{s['name']}" if (INPUT_DIR / s["name"]).is_file() else None
        return data

    @app.get("/audio/{name}")
    def audio(name: str):
        return FileResponse(safe_file(OUTPUT_DIR, name, {".wav", ".mp3"}))  # supports Range, so seeking works

    @app.get("/recordings/{name}")
    def recording(name: str):
        return FileResponse(safe_file(INPUT_DIR, name, {".mp3"}), media_type="audio/mpeg")

    @app.post("/api/days/{date}/process")
    def process(date: str, body: ProcessBody | None = None):
        check_date(date)
        if date not in get_daily_batches(INPUT_DIR):
            raise HTTPException(404, f"No recordings for {date} in {INPUT_DIR}")
        processor.enqueue(date, body.hint if body else None)
        return processor.state_for(date) or {}

    @app.delete("/api/days/{date}/process")
    def cancel(date: str):
        check_date(date)
        if not processor.cancel(date):
            raise HTTPException(409, "Only queued days can be cancelled; a running day finishes first.")
        return {"cancelled": True}

    @app.post("/api/speakers/rename")
    def rename(body: RenameBody):
        try:
            updated = rename_speaker_core(body.old, body.new, body.merge)
        except NameTaken as e:
            raise HTTPException(409, str(e))
        except RenameError as e:
            raise HTTPException(400, str(e))
        log(f"{'Merged' if body.merge else 'Renamed'} '{body.old}' -> '{body.new}' (updated {updated} transcript(s)).")
        return {"updated": updated}

    return app


def serve(host: str, port: int, open_browser: bool = True, auto_process: bool = True, force: bool = False):
    import webbrowser
    import uvicorn

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    url = f"http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{port}"
    log(f"\nViewer running at {url}  (Ctrl+C to stop)")
    if host == "0.0.0.0" and not os.getenv("IN_DOCKER"):
        log("  Listening on all network interfaces: anyone on your network can open your recordings.")
    if auto_process:
        log(f"  Watching {INPUT_DIR}: new or incomplete days are transcribed in the background.")
    if open_browser:
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    uvicorn.run(create_app(auto_process, force), host=host, port=port, log_level="warning")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Voice recorder transcripts. By default: open the viewer right away and transcribe "
                    "new or incomplete days in the background (progress shows in the viewer).")
    parser.add_argument("--serve", action="store_true", help="viewer only; don't transcribe anything automatically")
    parser.add_argument("--no-serve", action="store_true", help="transcribe in this terminal and exit (no viewer)")
    parser.add_argument("--force", action="store_true", help="re-transcribe every day, not just new/incomplete ones")
    parser.add_argument("--num-speakers", type=int, help="with --no-serve: exact number of people talking")
    parser.add_argument("--min-speakers", type=int, help="with --no-serve: at least this many people talking")
    parser.add_argument("--max-speakers", type=int, help="with --no-serve: at most this many people talking")
    parser.add_argument("--speakers", action="store_true", help="list known speakers and exit")
    parser.add_argument("--rename", nargs=2, metavar=("OLD", "NEW"), help="rename a known speaker")
    parser.add_argument("--merge", nargs=2, metavar=("OLD", "INTO"),
                        help="the two names are the same person: move OLD's lines and voiceprints into INTO")
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"), help="viewer host (0.0.0.0 allows other devices)")
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "5000")), help="viewer port (default 5000)")
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab automatically")
    args = parser.parse_args()

    if args.speakers:
        list_speakers()
    elif args.rename:
        rename_speaker(*args.rename)
    elif args.merge:
        rename_speaker(*args.merge, merge=True)
    elif args.no_serve:
        hint = {k: v for k, v in (("num_speakers", args.num_speakers), ("min_speakers", args.min_speakers),
                                    ("max_speakers", args.max_speakers)) if v} or None
        try:
            process_all(force=args.force or bool(hint), hint=hint)
        except KeyboardInterrupt:
            log("\nProcessing interrupted.")
            sys.exit(130)
    else:
        if not args.serve:
            problems = setup_problems()
            if problems:  # still start: the viewer shows existing days, and the error on the day cards
                log("Transcription won't work until this is fixed:\n  - " + "\n  - ".join(problems))
        serve(args.host, args.port, not args.no_browser, auto_process=not args.serve, force=args.force)
