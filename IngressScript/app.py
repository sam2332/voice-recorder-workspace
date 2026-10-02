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
import uuid
import shutil
import argparse
import threading
import subprocess
import warnings
from pathlib import Path

import numpy as np
from dotenv import load_dotenv

load_dotenv()

from app_config import DB_PATH, HF_TOKEN
from storage import init_db, list_speakers
from voice_memory import (
    configure, unit, VoiceMemory,
    tv_names, mark_tv, teach_voice, train_lines, similar_lines, split_voice, restore_line_prints,
    voice_profiles, delete_voiceprint, delete_profile, set_profile_kind,
    RenameError, NameTaken, rename_speaker_core, rename_in_overlaps,
)

# We always hand pyannote in-memory audio, so its torchcodec file decoder is never used.
warnings.filterwarnings("ignore", message=r"(?s).*torchcodec is not installed correctly")

# --- CONFIGURATION ---
SCRIPT_DIR = Path(__file__).resolve().parent
INPUT_DIR = Path(os.getenv("RECORD_DIR", SCRIPT_DIR.parent / "RECORD"))          # Your voice recorder mount
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", SCRIPT_DIR / "processed_daily"))
LANGUAGE = os.getenv("LANGUAGE") or None  # e.g. "en"; unset = auto-detect from the first 30s
MIN_RECORDING_SECONDS = 3.0        # Skip accidental taps / clicks
CLIP_PAD_SECONDS = 0.4             # Extra audio kept either side of a saved clip so no word is cut off

# Speaker detection. Voiceprints are the diarization pipeline's own per-speaker centroids
# (wespeaker embeddings averaged over each speaker's clean, non-overlapping speech).
SAME_PERSON_THRESHOLD = 0.75       # Two of today's clusters this similar are one person, re-joined
MIN_SPEECH_UNDER_LINE = 0.3        # Lines with less detected voice under them than this are flagged as noise
OVERLAP_MIN_SECONDS = 0.4          # Someone else talking at least this long during a line...
OVERLAP_MIN_SHARE = 0.2            # ...or this share of it, tags the line "talking over: <name>"

# Whisper voice-activity detection: lower = picks up quieter / more distant speech
VAD_ONSET = 0.35
VAD_OFFSET = 0.25
SAMPLE_RATE = 16000

# Clothing rustle (mic rubbing on a shirt): loud scratchy hiss above ~2.5 kHz. 0 turns it off.
RUSTLE_STRENGTH = float(os.getenv("RUSTLE_STRENGTH", "1.0"))
RUSTLE_MAX_CUT_DB = 30             # The most the scratchy band is ever turned down
RUSTLE_MAXIMUM = 2.0               # strength value of the "Maximum" level (0 off, 0.5 gentle, 1 strong)
RUSTLE_MAX_CUT_DB_MAXIMUM = 45     # ...which cuts harder
RUSTLE_DUCK = 0.1                  # ...and turns rustle-only moments down this much (-20 dB), voice band too
RUSTLE_MIN_DB = 20                 # Quieter frames than this are left alone
RUSTLE_HOP = 256                   # Rustle map resolution (samples at 16 kHz = 16 ms)
# Things Whisper "hears" in pure noise. Lines like these that sit in rustle get flagged as noise.
NOISE_PHRASES = {"thank you", "thanks", "thank you very much", "thanks for watching", "thank you for watching",
                 "you", "so", "mm", "mmm", "hmm", "um", "uh", "the end"}
# Real words people say a lot; only treated as noise when they sit in rustle
NOISE_IF_RUSTLE = {"okay", "ok", "oh", "ah", "bye", "yeah", "damn"}
# Well-known Whisper inventions on silence (subtitle credits etc.): always noise
HALLUCINATIONS = ("teksting av", "tekstet av", "untertitel", "subtitles by", "sous-titres", "amara.org",
                  "thanks for watching", "thank you for watching", "please subscribe", "like and subscribe",
                  "transcribed by", "transcription by", "copyright", "www.", ".com")
# A day splits into segments wherever real speech stops for this long (a fan keeps the recorder running)
SEGMENT_GAP_SECONDS = 300
SEGMENT_PAD_SECONDS = 4.0          # silence kept either side of a segment so no word is cut off
SEGMENT_MIN_SPEECH_SECONDS = 4.0   # a stretch with less speech than this is noise, not a segment
SEGMENT_SPEECH_DB = 12.0           # a frame is speech when its voice band is this far above the local noise floor
SEGMENT_MIN_FRAMES = 5             # a second is speech with this many speechy tenths of a second
SEGMENT_DENSITY = 5                # ...and this many speech seconds among the 11 around it
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


# --- SETTINGS (chosen in the viewer; stored next to the voice database) ---
SETTINGS_PATH = Path(os.getenv("SETTINGS_PATH", DB_PATH.parent / "settings.json"))
DEFAULT_SETTINGS = {
    "setup_done": False,          # nothing is transcribed automatically until the user has been through setup
    "auto_transcribe": False,     # transcribe new / incomplete days in the background
    "auto_sync": False,           # start syncing on startup if the recorder is connected
    "auto_summarize": False,      # summarize new days and update overview automatically
    "language": LANGUAGE or "en",   # "" = detect
    "rustle_strength": RUSTLE_STRENGTH,
}
_settings_lock = threading.Lock()


def load_settings() -> dict:
    data = dict(DEFAULT_SETTINGS)
    try:
        data.update(json.loads(SETTINGS_PATH.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        pass
    return data


def save_settings(patch: dict) -> dict:
    allowed = {"setup_done": bool, "auto_transcribe": bool, "auto_sync": bool, "auto_summarize": bool, "language": str, "rustle_strength": float}
    with _settings_lock:
        data = load_settings()
        for key, kind in allowed.items():
            if key in patch and patch[key] is not None:
                data[key] = kind(patch[key])
        data["language"] = data["language"].strip().lower()[:8]
        data["rustle_strength"] = min(max(data["rustle_strength"], 0.0), RUSTLE_MAXIMUM)
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = SETTINGS_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(SETTINGS_PATH)
    return data


def setting(key: str):
    return load_settings()[key]


# --- RECORDER SYNC ---
# Copy (or move) recordings off the voice recorder when it's plugged in. SYNC_MODE=move deletes
# each file from the recorder once its copy has been verified.
SYNC_MODE = "move" if os.getenv("SYNC_MODE", "copy").strip().lower() == "move" else "copy"
# Extra folders to look for a recorder in (separated by ; or ,), besides the drives found automatically
SYNC_SOURCES = [p.strip() for p in re.split(r"[;,]", os.getenv("SYNC_SOURCES", "")) if p.strip()]
RECORDER_QUALITY = {"1": "32 kbps MP3", "2": "64 kbps MP3", "3": "128 kbps MP3", "4": "256 kbps WAV",
                    "5": "512 kbps WAV", "6": "768 kbps WAV", "7": "1536 kbps WAV"}


def _candidate_roots() -> list[Path]:
    roots = [Path(p) for p in SYNC_SOURCES]
    if sys.platform == "win32":
        import ctypes
        k32 = ctypes.windll.kernel32
        mask = k32.GetLogicalDrives()
        for i in range(26):
            if mask & (1 << i):
                root = f"{chr(65 + i)}:\\"
                # 2 = removable, 3 = fixed. Network and optical drives are skipped (slow / never a recorder).
                if k32.GetDriveTypeW(ctypes.c_wchar_p(root)) in (2, 3):
                    roots.append(Path(root))
    else:
        for pattern in ("/media/*", "/media/*/*", "/mnt/*", "/run/media/*/*", "/Volumes/*"):
            roots += [Path(p) for p in __import__("glob").glob(pattern)]
    return roots


def _volume_label(root: Path) -> str:
    if sys.platform == "win32":
        import ctypes
        buf = ctypes.create_unicode_buffer(261)
        if ctypes.windll.kernel32.GetVolumeInformationW(ctypes.c_wchar_p(str(root)), buf, 261,
                                                        None, None, None, None, 0):
            return f"{buf.value or 'Drive'} ({str(root).rstrip(chr(92))})"
    return root.name or str(root)


def _child(folder: Path, name: str) -> Path | None:
    """Case-insensitive child lookup (FAT drives and Linux mounts differ in case)."""
    try:
        return next((p for p in folder.iterdir() if p.name.lower() == name.lower()), None)
    except OSError:
        return None


def find_recorders() -> list[dict]:
    """Drives that look like the voice recorder: a RECORD folder next to SETTINGS.TXT."""
    found, seen = [], set()
    local = INPUT_DIR.resolve() if INPUT_DIR.exists() else INPUT_DIR
    for root in _candidate_roots():
        try:
            rec, cfg = _child(root, "RECORD"), _child(root, "SETTINGS.TXT")
            if not rec or not rec.is_dir() or not cfg or rec.resolve() == local or str(rec.resolve()) in seen:
                continue
            seen.add(str(rec.resolve()))
            files = sorted(f for f in rec.iterdir() if f.is_file() and FILE_PATTERN.match(f.name))
            new = [f for f in files if not ((INPUT_DIR / f.name).exists()
                                            and (INPUT_DIR / f.name).stat().st_size == f.stat().st_size)]
            quality = re.search(r"^BIT:(\d)", cfg.read_text(encoding="utf-8", errors="ignore"), re.M)
            found.append({
                "root": str(root), "label": _volume_label(root), "total": len(files),
                "new": len(new), "new_bytes": sum(f.stat().st_size for f in new),
                "days": sorted({FILE_PATTERN.match(f.name).group(1) for f in new}),
                "quality": RECORDER_QUALITY.get(quality.group(1)) if quality else None,
            })
        except OSError:
            continue
    return found


class Syncer:
    """Copies new recordings from the recorder into RECORD_DIR in the background, with progress."""

    def __init__(self, on_done=None):
        self.lock = threading.Lock()
        self.state: dict = {"running": False}
        self.on_done = on_done   # called with the dates that received new recordings

    def watch(self, interval: int = 60):
        """Periodically checks for new recordings and starts sync if auto_sync is on."""
        def _watch():
            while True:
                if setting("auto_sync") and not self.state.get("running"):
                    recorders = find_recorders()
                    for r in recorders:
                        if r["new"] > 0:
                            try:
                                self.start(r["root"])
                                break
                            except Exception as e:
                                log(f"[sync-watch] failed to start: {e}")
                time.sleep(interval)
        threading.Thread(target=_watch, daemon=True, name="recorder-sync-watch").start()

    def status(self) -> dict:
        with self.lock:
            return dict(self.state)

    def start(self, root: str) -> dict:
        with self.lock:
            if self.state.get("running"):
                return dict(self.state)
            match = next((r for r in find_recorders() if r["root"] == root), None)
            if not match:
                raise FileNotFoundError("The recorder isn't connected any more.")
            self.state = {"running": True, "root": root, "label": match["label"], "mode": SYNC_MODE,
                          "files_done": 0, "files_total": match["new"], "bytes_done": 0,
                          "bytes_total": match["new_bytes"], "current": None, "error": None,
                          "copied": [], "days": match["days"], "started": time.time()}
        threading.Thread(target=self._run, args=(Path(root),), daemon=True, name="recorder-sync").start()
        return self.status()

    def _set(self, **kw):
        with self.lock:
            self.state.update(kw)

    def _run(self, root: Path):
        try:
            rec = _child(root, "RECORD")
            INPUT_DIR.mkdir(parents=True, exist_ok=True)
            for src in sorted(f for f in rec.iterdir() if f.is_file() and FILE_PATTERN.match(f.name)):
                dst = INPUT_DIR / src.name
                size = src.stat().st_size
                if dst.exists() and dst.stat().st_size == size:
                    if SYNC_MODE == "move":
                        src.unlink()   # already safely in the library
                    continue
                self._set(current=src.name)
                part = dst.with_name(dst.name + ".part")
                with open(src, "rb") as fi, open(part, "wb") as fo:
                    while chunk := fi.read(4 << 20):
                        fo.write(chunk)
                        with self.lock:
                            self.state["bytes_done"] += len(chunk)
                shutil.copystat(src, part)   # keep the recording's own timestamp
                if part.stat().st_size != size:
                    raise IOError(f"Copy of {src.name} came out the wrong size; the recorder copy was kept.")
                part.replace(dst)
                if SYNC_MODE == "move":
                    src.unlink()
                with self.lock:
                    self.state["files_done"] += 1
                    self.state["copied"].append(src.name)
            log(f"[sync] {'Moved' if SYNC_MODE == 'move' else 'Copied'} {self.state['files_done']} recording(s) from {root}")
            days = sorted({FILE_PATTERN.match(n).group(1) for n in self.state["copied"]})
            if days and self.on_done:
                self.on_done(days)
        except Exception as e:
            log(f"[sync] failed: {e}")
            self._set(error=str(e))
            for p in INPUT_DIR.glob("*.part"):
                p.unlink(missing_ok=True)
        finally:
            self._set(running=False, current=None, finished=time.time())


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


# Layout: processed_daily/<YYYY-MM-DD>/{transcript.json, merged.wav, merged.sources.json, rustle.npy, summary.json}
# plus processed_daily/clip_levels.json shared by all days.
def day_dir(date: str) -> Path:
    return OUTPUT_DIR / date


def transcript_path(date: str) -> Path:
    return day_dir(date) / "transcript.json"


def all_transcripts() -> list[tuple[str, Path]]:
    """(date, transcript path) for every processed day, oldest first."""
    if not OUTPUT_DIR.is_dir():
        return []
    return [(d.name, d / "transcript.json") for d in sorted(OUTPUT_DIR.iterdir())
            if d.is_dir() and DATE_RE.match(d.name) and (d / "transcript.json").is_file()]


def rustle_mask_path(date_str: str) -> Path:
    return day_dir(date_str) / "rustle.npy"


def prepare_daily_audio(date_str: str, file_list: list[Path]) -> tuple[Path, list[dict]]:
    """Cut the day's speech segments out of the recordings, each through its own levels (gain / gate / clipping
    repair), clean up clothing rustle, and join them into <date>/merged.wav. Every segment is also kept as its
    own file in <date>/segments/. Returns the merged file and the segments as sources (where each one sits in it)."""
    from scipy.io import wavfile
    import wave
    day = day_dir(date_str)
    seg_dir = segment_dir(date_str)
    seg_dir.mkdir(parents=True, exist_ok=True)
    merged_path, manifest, mask_path = day / "merged.wav", day / "merged.sources.json", rustle_mask_path(date_str)
    segs = day_segments(date_str, file_list)
    if not segs:
        raise RuntimeError("No speech was found in this day's recordings.")
    strength = setting("rustle_strength")
    by_name = {f.name: f for f in file_list}
    levels = {g["key"]: {k: v for k, v in clip_levels(g["key"]).items() if k not in ("reviewed", "auto")} for g in segs}
    sigs = {g["key"]: {"size": by_name[g["file"]].stat().st_size, "start": g["start"], "duration": g["duration"],
                       "rustle": strength, "levels": levels[g["key"]]} for g in segs}
    # Rebuilt only when the recordings, a segment's levels, or the rustle setting change
    if merged_path.exists() and manifest.exists() and mask_path.exists():
        try:
            saved = json.loads(manifest.read_text(encoding="utf-8"))
            if saved.get("sig") == sigs:
                return merged_path, saved["sources"]
        except (OSError, json.JSONDecodeError, KeyError):
            pass

    masks = []
    for g in segs:
        key, wav, npy, sig_file = g["key"], seg_dir / f"{g['key']}.wav", seg_dir / f"{g['key']}.npy", seg_dir / f"{g['key']}.json"
        try:
            fresh = wav.exists() and npy.exists() and json.loads(sig_file.read_text(encoding="utf-8")) == sigs[key]
        except (OSError, json.JSONDecodeError):
            fresh = False
        if not fresh:
            lv = levels[key]
            tmp = wav.with_suffix(".tmp.wav")
            cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{g['start']}", "-t", f"{g['duration']}",
                   "-i", str(by_name[g["file"]]), "-af", clip_chain(lv) + ",highpass=f=80,speechnorm=e=4:r=0.0001:l=1",
                   "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", str(tmp)]
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    raise RuntimeError(f"ffmpeg failed cutting {key}:\n{proc.stderr.strip()[-200:]}")
                with wave.open(str(tmp)) as w:
                    n = w.getnframes()
                mask = derustle_wav(tmp, [(0, n, strength if lv["rustle"] is None else lv["rustle"])])
                np.save(npy, mask)
                tmp.replace(wav)
                sig_file.write_text(json.dumps(sigs[key]), encoding="utf-8")
            finally:
                tmp.unlink(missing_ok=True)
    for stale in seg_dir.iterdir():
        if stale.stem not in sigs and stale.stem.removesuffix(".tmp") not in sigs:
            stale.unlink(missing_ok=True)

    # Join the segments; each is padded to a whole number of rustle-map steps so the map lines up
    tmp_merged = merged_path.with_suffix(".tmp.wav")
    sources, offset = [], 0
    try:
        with wave.open(str(tmp_merged), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            for g in segs:
                _, data = wavfile.read(seg_dir / f"{g['key']}.wav")
                pad = (-len(data)) % RUSTLE_HOP
                w.writeframes(data.astype(np.int16).tobytes() + bytes(2 * pad))
                masks.append(np.load(seg_dir / f"{g['key']}.npy"))
                sources.append({"name": g["key"], "file": g["file"], "file_start": g["start"],
                                "start": round(offset / SAMPLE_RATE, 3), "duration": round((len(data) + pad) / SAMPLE_RATE, 3),
                                "recorded_at": g["recorded_at"], "bytes": sigs[g["key"]]["size"]})
                offset += len(data) + pad
        mask = np.concatenate(masks)
        np.save(mask_path, mask)
        tmp_merged.replace(merged_path)
    finally:
        tmp_merged.unlink(missing_ok=True)
    manifest.write_text(json.dumps({"sig": sigs, "sources": sources}), encoding="utf-8")
    total = sum(probe_duration(f) for f in file_list)
    log(f"      {len(segs)} speech segment(s): {offset / SAMPLE_RATE / 60:.0f} of {total / 60:.0f} min kept; "
        f"rustle suppressed in {mask.mean() * 100:.0f}% of it")
    return merged_path, sources


# --- CLOTHING RUSTLE SUPPRESSION ---
def suppress_rustle(x: np.ndarray, sr: int = SAMPLE_RATE, strength: float = RUSTLE_STRENGTH):
    """Turn down fabric rustle (a mic rubbing on a shirt) in float audio. Rustle is loud hiss whose
    energy sits mostly above ~2.5 kHz, while voices keep most of theirs below 1 kHz. Where the high
    band swamps the voice band for longer than a syllable (so 's' sounds are left alone), the high
    band is pulled down to a speech-like level and 1-2.5 kHz gets half that cut. The voice band is
    never touched, so speech under the rustle survives.
    strength >= RUSTLE_MAXIMUM ("Maximum") also catches lighter rustle, cuts harder (both upper bands,
    up to RUSTLE_MAX_CUT_DB_MAXIMUM) and turns the whole sound down during rustle with no speech in it,
    at the risk of swallowing a quiet word said while rustling.
    Returns (cleaned audio, rustle mask with one bool per RUSTLE_HOP samples)."""
    n, hop = 2 * RUSTLE_HOP, RUSTLE_HOP
    n_hops = (len(x) + hop - 1) // hop
    if len(x) < 4 * n:
        return x, np.zeros(n_hops, bool)
    win = np.sqrt(np.hanning(n + 1)[:-1]).astype(np.float32)   # sqrt-Hann at 50% overlap reconstructs exactly
    freqs = np.fft.rfftfreq(n, 1 / sr)
    voice_b = (freqs >= 100) & (freqs < 1000)
    mid_b = (freqs >= 1000) & (freqs < 2500)
    high_b = freqs >= 2500
    maximum = strength >= RUSTLE_MAXIMUM
    floor = 10 ** (-(RUSTLE_MAX_CUT_DB_MAXIMUM if maximum else RUSTLE_MAX_CUT_DB) / 20)

    pad = np.concatenate([np.zeros(n, np.float32), x.astype(np.float32), np.zeros(n + hop, np.float32)])
    total = (len(pad) - n) // hop + 1
    frames = np.lib.stride_tricks.sliding_window_view(pad, n)[::hop][:total] * win
    X = np.fft.rfft(frames, axis=1)
    P = (X.real ** 2 + X.imag ** 2) + 1e-12
    v = P[:, voice_b].sum(1)
    h = P[:, high_b].sum(1)
    rustle = (h > (1.0 if maximum else 1.5) * v) & (10 * np.log10(P.sum(1)) > RUSTLE_MIN_DB)
    # Must persist ~240 ms: 's'/'sh' sounds are shorter than that, rustle bursts are longer
    rustle = np.convolve(rustle.astype(np.float32), np.ones(15) / 15, mode="same") > 0.5
    if strength > 0:
        target = 0.1 if maximum else 0.3                 # high band vs voice band that speech normally has
        g_high = np.where(rustle, np.clip(np.sqrt(target * v / h), floor, 1.0), 1.0) ** min(strength, 1.0)
        g_high = np.convolve(g_high, np.ones(5) / 5, mode="same").astype(np.float32)  # no pumping/clicks
        X[:, high_b] *= g_high[:, None]
        X[:, mid_b] *= (g_high if maximum else np.sqrt(g_high))[:, None]
        if maximum:
            # Rustle with no voice under it: turn everything down, voice band included
            voiceless = rustle & (v < 0.25 * h)
            g_all = np.convolve(np.where(voiceless, RUSTLE_DUCK, 1.0), np.ones(5) / 5, mode="same").astype(np.float32)
            X *= g_all[:, None]
    y = np.fft.irfft(X, n=n, axis=1).astype(np.float32) * win
    out = np.zeros(len(pad), np.float32)          # overlap-add; hop is exactly half a frame
    out[:total * hop] += y[:, :hop].reshape(-1)
    out[hop:(total + 1) * hop] += y[:, hop:].reshape(-1)
    # Frame k is centred on sample (k - 1) * hop of x
    mask = rustle[1:n_hops + 1]
    return out[n:n + len(x)], np.pad(mask, (0, max(0, n_hops - len(mask))))


def derustle_wav(path: Path, regions: list[tuple[int, int, float]]) -> np.ndarray:
    """Clean a 16 kHz mono WAV in place. `regions` gives (start sample, end sample, strength) per
    recording, so each clip can have its own rustle setting. Works in ~10-minute pieces so multi-hour
    days stay light on memory. Returns the rustle mask for the whole file."""
    from scipy.io import wavfile
    sr, data = wavfile.read(path, mmap=True)
    piece, ctx = RUSTLE_HOP * 37500, RUSTLE_HOP * 64   # ~10 min pieces, ~1 s of context each side
    out = np.empty(len(data), np.int16)
    mask = np.zeros((len(data) + RUSTLE_HOP - 1) // RUSTLE_HOP, bool)
    # Contiguous, hop-aligned regions that cover every sample (clip lengths are rounded)
    regions = sorted(regions) or [(0, len(data), RUSTLE_STRENGTH)]
    starts = [0] + [r[0] // RUSTLE_HOP * RUSTLE_HOP for r in regions[1:]]
    bounds = [(starts[i], starts[i + 1] if i + 1 < len(starts) else len(data), regions[i][2])
              for i in range(len(regions))]
    for r0, r1, strength in bounds:
        for a in range(r0, r1, piece):
            lo, hi = max(0, a - ctx), min(len(data), a + piece + ctx)
            y, m = suppress_rustle(data[lo:hi].astype(np.float32) / 32768, sr, strength)
            b = min(a + piece, r1)
            out[a:b] = np.clip(y[a - lo:b - lo] * 32768, -32768, 32767).astype(np.int16)
            ma, mb = a // RUSTLE_HOP, (b + RUSTLE_HOP - 1) // RUSTLE_HOP
            mask[ma:mb] = m[(a - lo) // RUSTLE_HOP:(a - lo) // RUSTLE_HOP + (mb - ma)]
    del data
    tmp = path.with_suffix(".clean.wav")
    wavfile.write(tmp, sr, out)
    tmp.replace(path)
    return mask


def rustle_share(mask: np.ndarray | None, start: float, end: float) -> float:
    """Fraction of a stretch of the merged day audio that was rustle."""
    if mask is None or not len(mask):
        return 0.0
    a, b = int(start * SAMPLE_RATE / RUSTLE_HOP), int(np.ceil(end * SAMPLE_RATE / RUSTLE_HOP))
    seg = mask[a:max(b, a + 1)]
    return float(seg.mean()) if len(seg) else 0.0


def looks_like_noise(text: str, rustle: float, score: float | None) -> bool:
    """A transcript line that is most likely Whisper 'hearing' words in rustle or other noise."""
    if any(h in text.lower() for h in HALLUCINATIONS):
        return True
    words = re.sub(r"[^\w\s']", " ", text.lower()).split()
    phrase = " ".join(dict.fromkeys(words))  # "so so" -> "so"
    weak = score is not None and score < 0.5
    if phrase in NOISE_PHRASES and (rustle >= 0.4 or weak):
        return True
    if phrase in NOISE_IF_RUSTLE and rustle >= 0.6:
        return True
    return rustle >= 0.8 and len(words) <= 4 and (score is None or score < 0.6)


# --- PER-CLIP LEVELS (gain, speech sensitivity, rustle cleanup, noise gate, clipping repair) ---
# Speech sensitivity 1..5 -> Whisper voice-activity onset/offset. 3 is the normal setting.
SENSITIVITY = {1: (0.60, 0.45), 2: (0.48, 0.35), 3: (VAD_ONSET, VAD_OFFSET), 4: (0.25, 0.18), 5: (0.15, 0.10)}
QUIET_SPEECH_DB = -32      # loud parts of a clip below this = "very quiet" (normal recordings sit at -14..-22)
NOISY_FLOOR_DB = -38       # background above this, with little gap to the speech = "noisy"
CLIPPED_PCT = 0.05         # % of samples pinned at full scale = "clipping"
WAVE_BUCKETS = 1000        # waveform resolution sent to the viewer
_levels_lock = threading.Lock()


def levels_path() -> Path:
    return OUTPUT_DIR / "clip_levels.json"


def load_levels() -> dict[str, dict]:
    try:
        return json.loads(levels_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def clip_levels(name: str) -> dict:
    """Levels for one recording: saved ones, else defaults (rustle None = the global setting)."""
    lv = {"gain_db": 0.0, "sensitivity": 3, "rustle": None, "gate_db": None, "declip": False, "reviewed": False,
          "auto": False}
    lv.update(load_levels().get(name, {}))
    return lv


def save_levels(updates: dict[str, dict], reviewed: bool = True) -> dict[str, dict]:
    with _levels_lock:
        data = load_levels()
        for name, lv in updates.items():
            if not (FILE_PATTERN.match(name) or SEGMENT_KEY_RE.match(name)):
                continue
            cur = clip_levels(name)
            rustle = lv.get("rustle", cur["rustle"])
            gate = lv.get("gate_db", cur["gate_db"])
            cur.update({
                "gain_db": float(min(max(float(lv.get("gain_db", cur["gain_db"])), -24), 36)),
                "sensitivity": int(min(max(int(lv.get("sensitivity", cur["sensitivity"])), 1), 5)),
                "rustle": None if rustle is None else float(min(max(float(rustle), 0), RUSTLE_MAXIMUM)),
                "gate_db": None if gate is None else float(min(max(float(gate), -80), -15)),
                "declip": bool(lv.get("declip", cur["declip"])),
                "reviewed": reviewed or cur["reviewed"],
                "auto": bool(lv.get("auto", False)),   # set by auto-adjust; cleared when the user edits
            })
            data[name] = cur
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        tmp = levels_path().with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(levels_path())
        return data


def clip_chain(lv: dict) -> str:
    """ffmpeg filters applied to one recording before the day is joined together."""
    parts = []
    if lv.get("declip"):
        parts.append("adeclip")                          # rebuild clipped peaks (at the original rate)
    parts += [f"aresample={SAMPLE_RATE}", "aformat=sample_fmts=fltp:channel_layouts=mono"]
    if lv.get("gain_db"):
        parts += [f"volume={lv['gain_db']:.1f}dB", "asoftclip=type=hard:threshold=1"]  # too much gain really clips
    if lv.get("gate_db") is not None:
        parts.append(f"agate=threshold={10 ** (lv['gate_db'] / 20):.6f}:range=0.01:attack=5:release=200")
    return ",".join(parts)


def decode_mono(path: Path, start: float = 0.0, seconds: float | None = None, chain: str | None = None,
                post: str = "") -> np.ndarray:
    """Decode (part of) a recording to 16 kHz mono float, optionally through a filter chain."""
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}"]
    if seconds:
        cmd += ["-t", f"{seconds:.3f}"]
    cmd += ["-i", str(path)]
    af = ",".join(p for p in (chain or f"aresample={SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=mono", post) if p)
    cmd += ["-af", af, "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "f32le", "-"]
    out = subprocess.run(cmd, capture_output=True)
    if out.returncode != 0:
        raise RuntimeError(f"Couldn't read {path.name}: {out.stderr.decode(errors='ignore').strip()[:200]}")
    return np.frombuffer(out.stdout, np.float32)


_analysis_cache: dict[tuple, dict] = {}


def analyze_clip(path: Path, start: float = 0.0, seconds: float | None = None, name: str | None = None) -> dict:
    """Level statistics, problems and a waveform for a recording, or just the part of it from `start` for
    `seconds` (a segment). Cached per file version."""
    key = (str(path), path.stat().st_size, path.stat().st_mtime, start, seconds)
    if key in _analysis_cache:
        return _analysis_cache[key]
    db = lambda v: 20 * np.log10(np.maximum(v, 1e-9))
    x = decode_mono(path, start, seconds)
    # Clipping is judged on the original samples: runs of 3+ pinned near full scale
    cut = ["-ss", f"{start:.3f}"] + (["-t", f"{seconds:.3f}"] if seconds else [])
    raw = subprocess.run(["ffmpeg", "-v", "error", *cut, "-i", str(path), "-f", "f32le", "-"], capture_output=True).stdout
    r = np.abs(np.frombuffer(raw, np.float32)) >= 0.98
    clipped_pct = float((np.convolve(r.astype(np.int8), np.ones(3, np.int8), mode="same") >= 3).mean() * 100) if len(r) else 0.0
    del raw, r

    frame = SAMPLE_RATE // 20                                    # 50 ms
    n = len(x) // frame
    rms = db(np.sqrt((x[:n * frame].reshape(-1, frame) ** 2).mean(1))) if n else np.array([-90.0])
    speech, floor = (float(v) for v in np.percentile(rms, [95, 10]))
    peak = float(db(np.abs(x).max())) if len(x) else -90.0

    # Waveform: per bucket peak and RMS (linear, 0..1+)
    b = max(1, len(x) // WAVE_BUCKETS)
    nb = max(1, len(x) // b)
    xb = np.abs(x[:nb * b]).reshape(nb, b) if len(x) >= b else np.abs(x).reshape(1, -1)
    peaks = np.round(xb.max(1), 4).tolist()
    rmsb = np.round(np.sqrt((xb ** 2).mean(1)), 4).tolist()

    # How much of the recording is clothing rustle (Strong-level detection), in 10-minute pieces
    piece = SAMPLE_RATE * 600
    masks = [suppress_rustle(x[i:i + piece], SAMPLE_RATE, 0)[1] for i in range(0, len(x), piece)]
    rustle_pct = float(np.concatenate(masks).mean() * 100) if masks else 0.0

    issues = []
    if clipped_pct > CLIPPED_PCT:
        issues.append({"code": "clipping", "label": "Clipping",
                       "detail": f"{clipped_pct:.2f}% of the audio is cut off at full volume. Repair clipping can rebuild the peaks."})
    if speech < QUIET_SPEECH_DB:
        issues.append({"code": "quiet", "label": "Very quiet",
                       "detail": f"Speech peaks around {speech:.0f} dBFS (normal is about -15 to -22)."})
    if floor > NOISY_FLOOR_DB and speech - floor < 15:
        issues.append({"code": "noisy", "label": "Noisy",
                       "detail": f"Background noise sits at {floor:.0f} dBFS, close to the speech ({speech:.0f} dBFS)."})
    result = {"name": name or path.name, "duration": round(len(x) / SAMPLE_RATE, 2), "peak_db": round(peak, 1),
              "speech_db": round(speech, 1), "floor_db": round(floor, 1), "clipped_pct": round(clipped_pct, 3),
              "rustle_pct": round(rustle_pct, 1), "issues": issues, "peaks": peaks, "rms": rmsb}
    result["auto"] = auto_levels(result)
    _analysis_cache[key] = result
    return result


def auto_levels(a: dict) -> dict:
    """Best-guess levels from the measurements (no test transcription). Returns
    {"levels", "notes", "confident"}: confident = it should fix every problem the clip was flagged for."""
    speech, floor, peak, clipped = a["speech_db"], a["floor_db"], a["peak_db"], a["clipped_pct"]
    snr = speech - floor
    lv = {"gain_db": 0.0, "sensitivity": 3, "rustle": None, "gate_db": None, "declip": False}
    notes, problems = [], []
    if clipped > CLIPPED_PCT:
        lv["declip"] = True
        notes.append("repair clipping")
        if clipped > 1.0:
            problems.append("too heavily clipped to fully repair")
    # Volume: bring the loud parts of speech to about -18 dBFS, without pushing peaks past -1 dBFS.
    # Recordings already in the normal range (-24..-8) are left alone; normalisation evens those out.
    gain = 0.0 if -24 <= speech <= -8 else -18 - speech
    if gain > 0 and not lv["declip"]:
        gain = min(gain, -1 - peak)
    gain = round(max(-12, min(30, gain)))
    gain = 0 if abs(gain) < 3 else gain
    lv["gain_db"] = float(gain)
    if gain:
        notes.append(f"volume {gain:+d} dB")
    if speech + gain < QUIET_SPEECH_DB + 6:
        problems.append("can't be made loud enough without clipping")
    # Sensitivity: clean recordings can listen harder for quiet voices; noisy ones should listen less
    lv["sensitivity"] = 4 if snr >= 30 else 3 if snr >= 18 else 2
    if lv["sensitivity"] != 3:
        notes.append(f"sensitivity {'High' if lv['sensitivity'] == 4 else 'Low'}")
    # Noise gate just above the background, but only when the background is clearly audible
    if floor + gain > -45 and snr >= 10:
        lv["gate_db"] = float(round(max(-80, min(-20, floor + gain + 3))))
        notes.append(f"noise gate {lv['gate_db']:.0f} dB")
    if snr < 10:
        problems.append("speech is barely louder than the background")
    # Rustle: by how much of the recording is rustle
    lv["rustle"] = RUSTLE_MAXIMUM if a["rustle_pct"] >= 10 else 1.0 if a["rustle_pct"] >= 2 else 0.5
    notes.append(f"rustle {'Maximum' if lv['rustle'] >= RUSTLE_MAXIMUM else 'Strong' if lv['rustle'] >= 1 else 'Gentle'}"
                 f" ({a['rustle_pct']:.0f}% rustle)")
    return {"levels": lv, "notes": notes, "problems": problems, "confident": not problems}


def flagged_clips(segs: list[dict], autofix: bool = False) -> list[str]:
    """Segments with problems that the user hasn't looked at yet (returns their keys). With autofix, problems
    the auto-adjust rules can confidently fix are fixed (and saved) instead of being reported."""
    flagged = []
    for seg in segs:
        if clip_levels(seg["key"])["reviewed"]:
            continue
        a = analyze_segment(seg)
        if not a["issues"]:
            continue
        if autofix and a["auto"]["confident"]:
            save_levels({seg["key"]: {**a["auto"]["levels"], "auto": True}})
            log(f"      {seg['key']}: {', '.join(i['label'].lower() for i in a['issues'])} -> auto-adjusted "
                f"({', '.join(a['auto']['notes'])})")
            continue
        flagged.append(seg["key"])
    return flagged


def preview_wav(path: Path, start: float, lv: dict, seconds: float = 10.0) -> bytes:
    """A short WAV of the recording exactly as transcription will hear it."""
    import io
    from scipy.io import wavfile
    y = decode_mono(path, max(0.0, start), seconds, clip_chain(lv), "highpass=f=80,speechnorm=e=4:r=0.0001:l=1")
    strength = setting("rustle_strength") if lv.get("rustle") is None else lv["rustle"]
    if strength > 0 and len(y):
        y, _ = suppress_rustle(y, SAMPLE_RATE, strength)
    buf = io.BytesIO()
    wavfile.write(buf, SAMPLE_RATE, (np.clip(y, -1, 1) * 32767).astype(np.int16))
    return buf.getvalue()


# --- SEGMENTS: a day split wherever real speech stops for a long time ---
def speech_spans(x: np.ndarray) -> list[tuple[float, float]]:
    """(start, end) seconds of the stretches of one recording that contain speech. Steady noise (a fan)
    can't count as speech: a frame is speech only when its voice band rises well above the local noise
    floor (the quietest fifth of the surrounding minute) and isn't clothing rustle. Stretches closer than
    SEGMENT_GAP_SECONDS are joined; ones with almost no speech are dropped."""
    from scipy.ndimage import percentile_filter
    frame = SAMPLE_RATE // 50                                    # 20 ms
    nf = len(x) // frame // 5 * 5
    if nf < 5:
        return []
    freqs = np.fft.rfftfreq(frame, 1 / SAMPLE_RATE)
    voice, high = (freqs >= 100) & (freqs < 1000), freqs >= 2500
    win = np.hanning(frame).astype(np.float32)
    v, h = np.empty(nf, np.float32), np.empty(nf, np.float32)
    for a in range(0, nf, 20000):
        b = min(nf, a + 20000)
        p = np.abs(np.fft.rfft(x[a * frame:b * frame].reshape(-1, frame) * win, axis=1)) ** 2
        v[a:b], h[a:b] = p[:, voice].sum(1), p[:, high].sum(1)
    v, h = v.reshape(-1, 5).mean(1), h.reshape(-1, 5).mean(1)    # 100 ms
    vdb = 10 * np.log10(v + 1e-9)
    floor = percentile_filter(vdb, 20, size=600, mode="nearest")
    speechy = (vdb > floor + SEGMENT_SPEECH_DB) & (h < 1.5 * v)
    sec = speechy[:len(speechy) // 10 * 10].reshape(-1, 10).sum(1) >= SEGMENT_MIN_FRAMES   # a second with enough speechy tenths
    # Speech comes in runs; scattered single seconds (a clatter, a door) don't count
    sec &= np.convolve(sec.astype(np.int8), np.ones(11, np.int8), mode="same") >= SEGMENT_DENSITY
    spans, start, last = [], None, None
    for i in np.flatnonzero(sec):
        if start is not None and i - last >= SEGMENT_GAP_SECONDS:
            spans.append((start, last + 1))
            start = None
        if start is None:
            start = i
        last = i
    if start is not None:
        spans.append((start, last + 1))
    total = len(x) / SAMPLE_RATE
    return [(float(max(0.0, a - SEGMENT_PAD_SECONDS)), float(min(total, b + SEGMENT_PAD_SECONDS)))
            for a, b in spans if sec[a:b].sum() >= SEGMENT_MIN_SPEECH_SECONDS]


SEGMENT_KEY_RE = re.compile(r"^(V\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}[^@]*)@(\d+)$")


def segments_path(date: str) -> Path:
    return day_dir(date) / "segments.json"


def day_segments(date: str, files: list[Path]) -> list[dict]:
    """The day's speech segments, one per stretch of speech inside a recording (never across two recordings).
    A segment is identified by its key '<recording name>@<start second>', which is also where its levels are saved.
    Found once per set of recordings and remembered in <date>/segments.json."""
    params = [SEGMENT_GAP_SECONDS, SEGMENT_PAD_SECONDS, SEGMENT_MIN_SPEECH_SECONDS, SEGMENT_SPEECH_DB, SEGMENT_MIN_FRAMES, SEGMENT_DENSITY]
    sig = {"files": [[f.name, f.stat().st_size] for f in files], "params": params}
    try:
        saved = json.loads(segments_path(date).read_text(encoding="utf-8"))
        if saved.get("sig") == sig:
            return saved["segments"]
    except (OSError, json.JSONDecodeError, KeyError):
        pass
    segs = []
    for f in files:
        x = decode_mono(f)
        total = len(x) / SAMPLE_RATE
        h, m, s = (int(v) for v in (recorded_at(f.name) or "00:00:00").split(":"))
        spans = speech_spans(x)
        if not spans and total < 120:
            spans = [(0.0, total)]   # a short clip: let transcription decide rather than risk losing a few words
        for a, b in spans:
            a, b = int(a), min(int(np.ceil(b)), int(total))   # whole seconds: the start is part of the key
            if b - a < 1:
                continue
            t = (h * 3600 + m * 60 + s + a) % 86400
            segs.append({"key": f"{f.stem}@{a:05d}", "file": f.name, "start": a, "end": b, "duration": b - a,
                         "recorded_at": f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"})
        del x
    day_dir(date).mkdir(parents=True, exist_ok=True)
    segments_path(date).write_text(json.dumps({"sig": sig, "segments": segs}, indent=1), encoding="utf-8")
    return segs


def segment_source(key: str) -> tuple[Path, int] | None:
    """The recording a segment key points into, and where the segment starts in it."""
    m = SEGMENT_KEY_RE.match(key)
    if not m:
        return None
    path = next((f for f in INPUT_DIR.iterdir() if f.is_file() and f.stem == m.group(1) and f.suffix.lower() in RECORDING_SUFFIXES), None) \
        if INPUT_DIR.is_dir() else None
    return (path, int(m.group(2))) if path else None


def segment_dir(date: str) -> Path:
    return day_dir(date) / "segments"


def analyze_segment(seg: dict) -> dict:
    return analyze_clip(INPUT_DIR / seg["file"], seg["start"], seg["duration"], seg["key"])


def day_parts(data: dict, gap: float = SEGMENT_GAP_SECONDS) -> list[dict]:
    """The day's segments with their lines and speakers. New transcripts are built from segments, so those
    are used as they are; older ones (one source per recording) are split wherever real speech stops for
    `gap` seconds, so a fan or rustle that keeps the recorder running doesn't hold two meetings together."""
    lines = sorted((s for s in data.get("segments", []) if not s.get("noise")), key=lambda s: s["start"])
    own = [s for s in data.get("sources", []) if isinstance(s, dict) and "file" in s]
    parts, talk = [], []
    if own:
        for src in own:
            end = src["start"] + src["duration"]
            parts.append({"start": src["start"], "end": end, "lines": 0})
            talk.append({})
            for s in lines:
                if src["start"] - 0.01 <= s["start"] < end:
                    parts[-1]["lines"] += 1
                    talk[-1][s.get("speaker", "Unknown")] = talk[-1].get(s.get("speaker", "Unknown"), 0.0) + s["end"] - s["start"]
    else:
        for s in lines:
            who = s.get("speaker", "Unknown")
            if parts and s["start"] - parts[-1]["end"] < gap:
                p = parts[-1]
                p["end"] = max(p["end"], s["end"])
                p["lines"] += 1
            else:
                parts.append({"start": s["start"], "end": s["end"], "lines": 1})
                talk.append({})
            talk[-1][who] = talk[-1].get(who, 0.0) + s["end"] - s["start"]
    for p, t in zip(parts, talk):
        p["speakers"] = sorted(t, key=t.get, reverse=True)
    return parts


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
        init_db().close()   # create / migrate the voice DB up front
        self.memory = VoiceMemory()
        self.whisper_model = whisperx.load_model(
            "large-v3", self.device, compute_type=compute_type,
            vad_options={"vad_onset": VAD_ONSET, "vad_offset": VAD_OFFSET})
        self.diarize_model = DiarizationPipeline(token=HF_TOKEN, device=self.device)

    def diarize(self, audio: np.ndarray, hint: dict, report):
        """Run pyannote directly (not via whisperx) to get both of its answers:
        - speaker_diarization: who is talking, overlaps included (several people at once)
        - exclusive_speaker_diarization: exactly one speaker at every moment, which pyannote recommends
          for matching words to speakers.
        Returns (overlap turns, exclusive turns, label -> embedding)."""
        import pandas as pd
        ranges = {"segmentation": (0.0, 50.0), "embeddings": (50.0, 99.0)}
        last = [0.0]

        def hook(step_name, step_artifact, file=None, total=None, completed=None):
            if total and completed is not None:
                a, b = ranges.get(step_name, (0.0, 99.0))
                pct = a + min(completed / total, 1.0) * (b - a)
                if pct > last[0]:
                    last[0] = pct
                    report(pct)

        data = {"waveform": self.torch.from_numpy(audio[None, :]), "sample_rate": SAMPLE_RATE}
        out = self.diarize_model.model(data, hook=hook, **hint)
        report(100)

        def frame(ann):
            return pd.DataFrame([(t.start, t.end, spk) for t, _, spk in ann.itertracks(yield_label=True)],
                                columns=["start", "end", "speaker"])

        labels = out.speaker_diarization.labels()
        emb = ({spk: out.speaker_embeddings[i] for i, spk in enumerate(labels)}
               if out.speaker_embeddings is not None else {})
        return frame(out.speaker_diarization), frame(out.exclusive_speaker_diarization), emb

    def process_day(self, date_key: str, files: list[Path], progress=None, hint: dict | None = None) -> Path:
        """Transcribe one day. `progress(fraction, label)` is called as work advances.
        `hint` may hold num_speakers, or min_speakers / max_speakers, to guide speaker detection."""
        torch, whisperx = self.torch, self.whisperx
        weights = {key: w for key, _, w in STEPS}
        total = sum(weights.values())
        done = {"w": 0}

        json_out = transcript_path(date_key)
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
            audio_file, sources = prepare_daily_audio(date_key, files)
            audio = whisperx.load_audio(str(audio_file))
            finish("merge")

            report = step("transcribe")
            # Each segment is transcribed with its own speech sensitivity, then put back on the day timeline
            language = setting("language") or None
            self.whisper_model.tokenizer = None   # whisperx would otherwise reuse the previous day's language
            if not language:
                # Whisper guesses the language from 30 s of audio; quiet or noisy openings make it guess
                # wrong (e.g. Norwegian), so give it the 30 s with the most speech energy in the day
                win = 30 * SAMPLE_RATE
                frame = SAMPLE_RATE // 2
                n = len(audio) // frame
                energy = np.sqrt((audio[:n * frame].reshape(-1, frame) ** 2).mean(1)) if n else np.zeros(1)
                per_win = np.convolve(energy, np.ones(60), mode="valid") if len(energy) >= 60 else energy
                start = int(np.argmax(per_win)) * frame if len(per_win) else 0
                language = self.whisper_model.detect_language(audio[start:start + win])
                log(f"      language detected: {language} (from {start / SAMPLE_RATE / 60:.1f} min in)")
            segments, total_secs, done_secs = [], sum(s["duration"] for s in sources) or 1, 0.0
            for src in sources:
                chunk = audio[int(src["start"] * SAMPLE_RATE):int((src["start"] + src["duration"]) * SAMPLE_RATE)]
                if len(chunk) >= SAMPLE_RATE:
                    onset, offset = SENSITIVITY[clip_levels(src["name"])["sensitivity"]]
                    self.whisper_model._vad_params = {**self.whisper_model._vad_params,
                                                      "vad_onset": onset, "vad_offset": offset}
                    part = self.whisper_model.transcribe(
                        chunk, batch_size=16, language=language,
                        progress_callback=lambda p, base=done_secs, d=src["duration"]: report((base + d * p / 100) / total_secs * 100))
                    language = language or part["language"]
                    for seg in part["segments"]:
                        seg["start"] += src["start"]
                        seg["end"] += src["start"]
                        segments.append(seg)
                done_secs += src["duration"]
            language = language or "en"
            result = {"segments": segments, "language": language}
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
            diarize_df, exclusive_df, raw_emb = self.diarize(audio, hint, report)
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
            exclusive_df["speaker"] = exclusive_df["speaker"].map(lambda l: rep.get(l, l))
            voices: dict[str, tuple[np.ndarray, float]] = {}
            for label in set(rep.values()):
                members = [l for l in rep if rep[l] == label]
                secs = sum(seconds[m] for m in members)
                voices[label] = (unit(sum(emb[m] * seconds[m] for m in members)), secs)

            # Words go to the one speaker pyannote is most sure of at that moment
            result = whisperx.assign_word_speakers(exclusive_df if len(exclusive_df) else diarize_df, result, fill_nearest=True)
            lines = split_by_speaker(result["segments"], language)

            turns = list(zip(diarize_df.start, diarize_df.end, diarize_df.speaker))
            mask = np.load(rustle_mask_path(date_key)) if rustle_mask_path(date_key).exists() else None
            # A "voice" that is mostly rustle is the shirt, not a person: don't give it a voiceprint
            for label in list(voices):
                spans = [(a, b) for a, b, l in turns if l == label]
                secs = sum(b - a for a, b in spans) or 1
                if sum(rustle_share(mask, a, b) * (b - a) for a, b in spans) / secs >= 0.7:
                    log(f"      {label} is mostly clothing rustle; not treated as a person")
                    del voices[label]
            prior = names_from_previous(turns, previous["segments"]) if previous else {}
            prior = {l: n for l, n in prior.items() if l in voices}
            names, voice_info = self.memory.assign(date_key, voices, prior)
            # assign() replaced the day's voiceprints; put back the ones taught from single lines
            line_prints = previous.get("line_prints", []) if previous else []
            if line_prints:
                restore_line_prints(date_key, line_prints)

            # Where diarization heard a voice; Whisper text with no voice under it is invented
            res = 100   # 10 ms
            heard = np.zeros(int(len(audio) / SAMPLE_RATE * res) + 1, bool)
            for a, b, _ in turns:
                heard[int(a * res):int(b * res) + 1] = True

            def voice_share(a, b):
                seg = heard[int(a * res):max(int(b * res), int(a * res) + 1)]
                return float(seg.mean()) if len(seg) else 0.0

            # Who else was talking during a line (people talking over each other)
            by_label: dict[str, list[tuple[float, float]]] = {}
            for a, b, l in turns:
                by_label.setdefault(l, []).append((a, b))

            def talking_over(line):
                a, b = line["start"], line["end"]
                need = max(OVERLAP_MIN_SECONDS, OVERLAP_MIN_SHARE * (b - a))
                others = []
                for l, spans in by_label.items():
                    if l == line["speaker"]:
                        continue
                    secs = sum(max(0.0, min(b, y) - max(a, x)) for x, y in spans if x < b and y > a)
                    if secs >= need:
                        others.append(l)
                return sorted(set(others))

            # Voices recognised as a TV / YouTube profile: lines stay visible, tagged TV in the viewer
            tv = tv_names()
            for l in voices:
                if names[l] in tv:
                    voice_info[l]["tv"] = True
                    log(f"      {l} is TV ('{names[l]}')")

            timeline = []
            for line in lines:
                if not line["text"].strip():
                    continue
                seg = {"start": round(line["start"], 2), "end": round(line["end"], 2),
                       "speaker": names.get(line["speaker"], "Unknown"), "text": line["text"]}
                if looks_like_noise(line["text"], rustle_share(mask, line["start"], line["end"]), line["score"]) \
                        or voice_share(line["start"], line["end"]) < MIN_SPEECH_UNDER_LINE:
                    seg["noise"] = True
                over = talking_over(line)
                if over and not seg.get("noise"):
                    seg["overlap_labels"] = over                                   # source of truth
                    seg["overlap"] = sorted({names.get(l, "Unknown") for l in over})  # names at the time
                timeline.append(seg)

            with TRANSCRIPT_LOCK:
                # Lines the user trashed stay gone after re-transcribing
                latest = load_transcript(json_out) if json_out.exists() else {}
                trashed = latest.get("trashed", [])
                timeline = [seg for seg in timeline if not overlaps_trashed(seg, trashed)]
                tmp_out = json_out.with_suffix(".tmp")
                tmp_out.write_text(json.dumps({
                    "date": date_key,
                    "language": language,
                    "audio": audio_file.name,
                    "speaker_hint": hint,
                    "sources": sources,
                    "recordings": [{"name": f.name, "bytes": f.stat().st_size} for f in files],
                    "segments": timeline,
                    "trashed": trashed,
                    "line_prints": latest.get("line_prints", line_prints),   # incl. any taught while this ran
                    "voices_reviewed": False,   # the viewer opens the voice review the first time this day is opened
                    # Per voice: how sure the match was and who else it might be (viewer suggestions)
                    "voices": [{"name": names[l], "label": l, "seconds": round(voices[l][1], 1), **voice_info[l],
                                "embedding": [round(float(x), 5) for x in unit(voices[l][0])]}
                               for l in voices],
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
    path = transcript_path(date_key)
    if not path.exists():
        return True
    data = load_transcript(path)
    recs = transcript_recordings(data)
    if {f.name for f in files} - {r["name"] for r in recs}:
        return True
    # A recording that was still being copied when the day was transcribed has since grown
    sizes = {r["name"]: r.get("bytes") for r in recs}
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
TRANSCRIPT_LOCK = threading.RLock()   # the viewer edits transcripts while the worker may be writing one


def write_transcript(path: Path, data: dict):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def overlaps_trashed(seg: dict, trashed: list[dict]) -> bool:
    """True if a new line mostly covers the same moment as a line the user trashed."""
    d = max(seg["end"] - seg["start"], 0.01)
    return any(min(seg["end"], t["end"]) - max(seg["start"], t["start"]) >= 0.5 * d for t in trashed)


def edit_lines(date: str, items: list[dict], action: str, new: list[dict] | None = None) -> int:
    """Viewer edits on a day's transcript. Lines are identified by start time + text.
    action: 'trash' (remove; remembered so re-transcribing won't bring them back),
            'restore' (undo a trash), 'keep' (it was flagged as noise but is real speech), or
            'replace' (swap `items` for the lines in `new`: edits, speaker changes, split, join, undo)."""
    path = transcript_path(date)
    same = lambda a, b: abs(a["start"] - b["start"]) < 0.02 and a["text"] == b["text"]
    with TRANSCRIPT_LOCK:
        data = json.loads(path.read_text(encoding="utf-8"))
        data.setdefault("trashed", [])
        changed = 0
        if action == "trash":
            keep = []
            for seg in data["segments"]:
                if any(same(seg, it) for it in items):
                    data["trashed"].append(seg)
                    changed += 1
                else:
                    keep.append(seg)
            data["segments"] = keep
        elif action == "restore":
            back = [t for t in data["trashed"] if any(same(t, it) for it in items)]
            data["trashed"] = [t for t in data["trashed"] if t not in back]
            for seg in back:
                seg.pop("noise", None)   # restoring a line says "this is real"
            data["segments"] = sorted(data["segments"] + back, key=lambda s: s["start"])
            changed = len(back)
        elif action == "keep":
            for seg in data["segments"]:
                if seg.get("noise") and any(same(seg, it) for it in items):
                    del seg["noise"]
                    changed += 1
        elif action == "replace":
            gone = [seg for seg in data["segments"] if any(same(seg, it) for it in items)]
            if len(gone) != len(items):
                raise ValueError("That line changed since the page loaded. Reload and try again.")
            data["segments"] = sorted([seg for seg in data["segments"] if seg not in gone] + (new or []),
                                      key=lambda s: s["start"])
            changed = len(gone) + len(new or [])
        if changed:
            write_transcript(path, data)
        return changed


def resolve_overlap_names(data: dict) -> dict:
    """Fill each line's "overlap" with the CURRENT names of the voices that talked over it
    (labels -> names via the day's voices list), dropping the line's own speaker."""
    label_name = {v["label"]: v["name"] for v in data.get("voices", []) if v.get("label")}
    for seg in data.get("segments", []):
        if seg.get("overlap_labels"):
            names = {label_name.get(l, "Unknown") for l in seg["overlap_labels"]}
            names.discard(seg.get("speaker"))
            if names:
                seg["overlap"] = sorted(names)
            else:
                seg.pop("overlap", None)
        elif seg.get("overlap"):
            seg["overlap"] = [n for n in seg["overlap"] if n != seg.get("speaker")]
            if not seg["overlap"]:
                seg.pop("overlap")
    return data


def relabel_speaker(date: str, old: str, new: str, lines: list[dict] | None = None) -> list[dict]:
    """Say who a voice is on ONE day: every line (or just `lines`) by `old` becomes `new`.
    Other days and the voice database are untouched. Returns the lines changed (for undo)."""
    path = transcript_path(date)
    same = lambda a, b: abs(a["start"] - b["start"]) < 0.02 and a["text"] == b["text"]
    with TRANSCRIPT_LOCK:
        data = json.loads(path.read_text(encoding="utf-8"))
        changed = []
        for seg in data.get("segments", []) + data.get("trashed", []):
            if seg.get("speaker") == old and (lines is None or any(same(seg, l) for l in lines)):
                seg["speaker"] = new
                changed.append({"start": seg["start"], "text": seg["text"]})
        if changed and lines is None:
            rename_in_overlaps(data, old, new)   # whole voice renamed: its "talking over" tags follow
        if changed:
            write_transcript(path, data)
        return changed


def mark_speaker_noise(date: str, speaker: str, noise: bool, lines: list[dict] | None = None) -> list[dict]:
    """Flag every line of one voice on ONE day as noise (a TV show, music...) or clear it again.
    Returns the lines changed, so undo can pass them back as `lines`."""
    path = transcript_path(date)
    same = lambda a, b: abs(a["start"] - b["start"]) < 0.02 and a["text"] == b["text"]
    with TRANSCRIPT_LOCK:
        data = json.loads(path.read_text(encoding="utf-8"))
        changed = []
        for seg in data.get("segments", []):
            if seg.get("speaker") != speaker or bool(seg.get("noise")) == noise:
                continue
            if lines is not None and not any(same(seg, l) for l in lines):
                continue
            if noise:
                seg["noise"] = True
            else:
                del seg["noise"]
            changed.append({"start": seg["start"], "text": seg["text"]})
        if changed:
            write_transcript(path, data)
        return changed


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


def has_edits(date: str) -> int:
    """How many lines of a day's transcript were edited by hand."""
    path = transcript_path(date)
    return sum(1 for s in load_transcript(path).get("segments", []) if s.get("edited")) if path.exists() else 0


def load_transcript(path: Path) -> dict:
    mtime = path.stat().st_mtime
    cached = _transcript_cache.get(str(path))
    if cached and cached[0] == mtime:
        return cached[1]
    data = json.loads(path.read_text(encoding="utf-8"))
    _transcript_cache[str(path)] = (mtime, data)
    return data


# Hand the voice_memory package the paths, helpers and lock it needs, so it never
# has to import app.py back (which would be circular). Runs once the helpers above exist.
configure(db_path=DB_PATH, day_dir=day_dir, transcript_path=transcript_path,
          all_transcripts=all_transcripts, load_transcript=load_transcript,
          write_transcript=write_transcript, lock=TRANSCRIPT_LOCK, log=log, hf_token=HF_TOKEN)


_part_count_cache: dict[str, tuple[float, int]] = {}


def part_count(path: Path) -> int:
    """Number of segments in a day, cached until its transcript file changes."""
    mtime = path.stat().st_mtime
    hit = _part_count_cache.get(str(path))
    if hit and hit[0] == mtime:
        return hit[1]
    n = len(day_parts(load_transcript(path)))
    _part_count_cache[str(path)] = (mtime, n)
    return n


def transcript_source_names(data: dict) -> list[str]:
    return [s["name"] if isinstance(s, dict) else s for s in data.get("sources", [])]


def transcript_recordings(data: dict) -> list[dict]:
    """The recordings a day was transcribed from ({name, bytes}). Sources are segments now, so newer
    transcripts list the recordings separately; older ones had one source per recording."""
    if "recordings" in data:
        return data["recordings"]
    return [{"name": s["name"], "bytes": s.get("bytes")} if isinstance(s, dict) else {"name": s, "bytes": None}
            for s in data.get("sources", [])]


def transcript_sources(data: dict) -> list[dict]:
    """Source recordings with offsets; older transcripts only stored filenames."""
    sources = data.get("sources", [])
    if all(isinstance(s, dict) for s in sources):
        return sources
    return describe_sources([INPUT_DIR / name for name in transcript_source_names(data)])


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


# --- DAY SUMMARIES (local Ollama) ---
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3.5:35b-a3b")
SUMMARY_CHUNK_CHARS = 20000        # transcript text per model call; long days are read in parts
SUMMARY_CTX = 16384                # model context window (tokens) to ask Ollama for

SUMMARY_CONTEXT = """You are summarising one day of audio from a personal voice recorder that its owner wears all day.
It picks up the owner, their roommates and anyone else nearby. Typical content:
- things someone says out loud that the household is out of or needs to buy,
- project ideas, usually with specifics (materials, sizes, steps, tools, costs),
- general chat with roommates, phone calls and meetings.
Transcript lines look like: [L12] 9:43 AM Speaker 2: text
The [L12] tag identifies the line. Speaker names are as written (some are placeholders like "Speaker 2").
The transcript comes from automatic speech recognition, so expect some mistakes; don't invent facts to fill gaps.
Only use what is in the transcript. Write in English."""

SUMMARY_FORMAT = """Write the summary in Markdown using exactly these sections, in this order. Leave out any section
that would be empty. Put the [L..] tag of the line(s) it came from at the end of every bullet.

## Overview
Two to four sentences on what the day was about.

## Conversations
- **Short title**: who was involved; one-line gist [L12]
  - a key point [L15]

## Shopping list
- [ ] item (who mentioned it, and why if said) [L40]

## Project ideas
### Idea name
- a specific detail that was mentioned [L50]
(Project ideas are things the owner or their roommates want to make, build, start or try. Work being
explained or discussed, like how a system at work functions, belongs under Conversations, not here.)

## To-dos
- [ ] task (who) [L60]

## Decisions & key facts
- fact, number, name or date worth remembering [L70]

Rules: no preamble or closing remarks; refer to people by the names in the transcript; skip filler and small talk
that has no content; never cite a [L..] tag that isn't in the transcript."""


def clock_label(sources: list[dict], t: float) -> str:
    """Wall-clock time (e.g. '9:43 AM') of a moment in the merged day audio."""
    src = next((s for s in reversed(sources) if isinstance(s, dict) and s.get("start", 0) <= t + 0.01), None)
    if not src or not src.get("recorded_at"):
        return f"{int(t // 60)}:{int(t % 60):02d}"
    h, m, s = (int(x) for x in src["recorded_at"].split(":"))
    secs = h * 3600 + m * 60 + s + int(t - src["start"])
    h, m = (secs // 3600) % 24, (secs // 60) % 60
    return f"{(h % 12) or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


def summary_path(date: str) -> Path:
    return day_dir(date) / "summary.json"


def transcript_fingerprint(data: dict) -> str:
    """Changes whenever the words or speakers that a summary is based on change."""
    import hashlib
    body = [(s.get("speaker"), s.get("text")) for s in data.get("segments", []) if not s.get("noise")]
    return hashlib.sha1(json.dumps(body, ensure_ascii=False).encode("utf-8")).hexdigest()


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


def drop_empty_sections(md: str) -> str:
    """Models sometimes write '## Shopping list' then '*No items mentioned.*' despite being told to
    leave empty sections out; remove sections with no real content."""
    out, block = [], []

    def flush():
        if not block:
            return
        body = [l for l in block[1:] if l.strip()]
        empty = block[0].startswith("## ") and (not body or all(
            re.match(r"^\s*[-*_(]*\s*(no|none|nothing|n/a)\b", l.strip(), re.I) for l in body))
        if not empty:
            out.extend(block)

    for line in md.split("\n"):
        if line.startswith("## "):
            flush()
            block = [line]
        else:
            block.append(line) if block else out.append(line)
    flush()
    return "\n".join(out).strip()


def dedupe_lines(text: str) -> str:
    """Drop repeated bullet lines (what a model stuck in a loop produces)."""
    seen, out = set(), []
    for line in text.split("\n"):
        key = re.sub(r"\s+", " ", line.strip().lower())
        if key.startswith(("-", "*")) and len(key) > 6:
            if key in seen:
                continue
            seen.add(key)
        out.append(line)
    return "\n".join(out)


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


def summarize_day(date: str, progress=None) -> dict:
    """Summarise a day's transcript with the local model. Long days are read in parts (notes per part),
    then the notes are turned into the final summary."""
    path = transcript_path(date)
    data = load_transcript(path)
    sources = data.get("sources", [])
    lines, refs = [], {}
    for i, s in enumerate(data.get("segments", [])):
        if s.get("noise") or not s.get("text", "").strip():
            continue
        ref = f"L{i + 1}"
        refs[ref] = s["start"]
        lines.append(f"[{ref}] {clock_label(sources, s['start'])} {s.get('speaker', 'Unknown').replace('_', ' ')}: {s['text']}")
    if not lines:
        raise RuntimeError("There's no speech in this day's transcript to summarise.")

    parts, cur = [], []
    for line in lines:
        if cur and sum(len(l) + 1 for l in cur) + len(line) > SUMMARY_CHUNK_CHARS:
            parts.append(cur)
            cur = []
        cur.append(line)
    parts.append(cur)

    day = toDate_label(date)
    if len(parts) == 1:
        if progress:
            progress(0.1, "Writing the summary")
        md = ollama_chat(f"Transcript for {day}:\n\n" + "\n".join(parts[0]) + "\n\n" + SUMMARY_FORMAT, SUMMARY_CONTEXT,
                         on_token=lambda k: progress and progress(min(0.95, 0.1 + k / 1500), f"Writing the summary ({k} words so far)"))
    else:
        notes = []
        for n, part in enumerate(parts, 1):
            if progress:
                progress((n - 1) / (len(parts) + 1), f"Reading part {n} of {len(parts)}" if len(parts) > 1 else "Reading the day")
            notes.append(ollama_chat(
                f"Part {n} of {len(parts)} of the transcript for {day}:\n\n" + "\n".join(part) +
                "\n\nWrite compact bullet-point notes on this part only: each conversation (topic, who), anything someone "
                "said they're out of or need to buy, project ideas with every specific mentioned, to-dos, decisions and "
                "key facts. End every bullet with the [L..] tag(s) it came from, copied exactly. No preamble.",
                SUMMARY_CONTEXT, max_tokens=900,
                on_token=lambda k, n=n: progress and progress((n - 1 + min(0.95, k / 900)) / (len(parts) + 1),
                                                              f"Reading part {n} of {len(parts)} ({k} words of notes)")))
        if progress:
            progress(len(parts) / (len(parts) + 1), "Writing the summary")
        md = ollama_chat(
            f"Notes on the transcript for {day}, part by part in time order:\n\n" +
            "\n\n".join(f"### Part {n}\n{t}" for n, t in enumerate(notes, 1)) +
            "\n\nCombine these notes into one summary of the whole day (merge duplicates; keep the [L..] tags).\n\n" + SUMMARY_FORMAT,
            SUMMARY_CONTEXT, max_tokens=2000,
            on_token=lambda k: progress and progress((len(parts) + min(0.95, k / 2000)) / (len(parts) + 1),
                                                     f"Writing the summary ({k} words so far)"))
    md = drop_empty_sections(md)
    # Tags can be single lines, lists or ranges: [L12], [L12, L15], [L30-L45]
    used = {f"L{n}" for tag in re.findall(r"\[(L\d+(?:\s*[-\u2013,]\s*L?\d+)*)\]", md) for n in re.findall(r"\d+", tag)}
    result = {"markdown": md, "model": OLLAMA_MODEL, "created": time.time(), "fingerprint": transcript_fingerprint(data),
              "refs": {r: refs[r] for r in used if r in refs}, "parts": len(parts)}
    tmp = summary_path(date).with_suffix(".tmp")
    tmp.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(summary_path(date))
    return result


def toDate_label(date: str) -> str:
    from datetime import date as _d
    try:
        return _d.fromisoformat(date).strftime("%A, %B %d, %Y")
    except ValueError:
        return date


# --- OVERVIEW: facts pulled out of each day as structured data (local Ollama, JSON-schema output) ---
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


class Extractor:
    """Fills in the Overview's data one day at a time, newest first, using the local model.
    Waits while transcription is running so the two don't fight over the GPU."""

    def __init__(self, busy=lambda: False):
        self.lock = threading.Lock()
        self.queue: list[str] = []
        self.current: dict | None = None     # {"date", "progress", "label"}
        self.errors: dict[str, str] = {}
        self.thread: threading.Thread | None = None
        self.busy = busy

    def state(self) -> dict:
        with self.lock:
            return {"current": dict(self.current) if self.current else None, "queued": list(self.queue),
                    "errors": dict(self.errors), "model": OLLAMA_MODEL}

    def enqueue(self, dates: list[str], retry: bool = False):
        with self.lock:
            for d in dates:
                if retry:
                    self.errors.pop(d, None)
                if d in self.queue or d in self.errors or (self.current and self.current["date"] == d):
                    continue
                self.queue.append(d)
            if self.queue and not (self.thread and self.thread.is_alive()):
                self.thread = threading.Thread(target=self._loop, daemon=True, name="overview-extract")
                self.thread.start()

    def _set(self, **kw):
        with self.lock:
            if self.current:
                self.current.update(kw)

    def _loop(self):
        while True:
            with self.lock:
                if not self.queue:
                    self.current = None
                    return
                date = self.queue.pop(0)
                self.current = {"date": date, "progress": 0.0, "label": "Waiting for transcription to finish"}
            while self.busy():
                time.sleep(10)
            try:
                with Summarizer._one_at_a_time:
                    self._set(label="Starting the model (first time takes about a minute)")
                    problems = ollama_problems()
                    if problems:
                        raise ConnectionError(" ".join(problems))
                    log(f"[overview] {date}: extracting with {OLLAMA_MODEL}")
                    extract_day(date, progress=lambda p, label: self._set(progress=p, label=label))
                log(f"[overview] {date}: done")
            except ConnectionError as e:
                # Ollama itself is the problem: stop here rather than failing every queued day
                with self.lock:
                    for d in [date] + self.queue:
                        self.errors[d] = str(e)
                    self.queue.clear()
            except Exception as e:
                log(f"[overview] {date} FAILED: {e}")
                with self.lock:
                    self.errors[date] = str(e)


class Summarizer:
    """Runs one summary at a time in the background so the viewer can show progress."""

    def __init__(self):
        self.lock = threading.Lock()
        self.jobs: dict[str, dict] = {}     # date -> {"status", "progress", "label", "error"}

    def state(self, date: str) -> dict:
        with self.lock:
            return dict(self.jobs.get(date, {}))

    def start(self, date: str):
        with self.lock:
            if self.jobs.get(date, {}).get("status") in ("queued", "running"):
                return
            self.jobs[date] = {"status": "queued", "progress": 0.0, "label": "Waiting"}
        threading.Thread(target=self._run, args=(date,), daemon=True, name=f"summary-{date}").start()

    _one_at_a_time = threading.Lock()

    def _set(self, date, **kw):
        with self.lock:
            self.jobs.setdefault(date, {}).update(kw)

    def _run(self, date: str):
        with self._one_at_a_time:
            self._set(date, status="running", label="Starting the model (first time takes about a minute)")
            try:
                problems = ollama_problems()
                if problems:
                    raise RuntimeError(" ".join(problems))
                log(f"[summary] {date}: summarising with {OLLAMA_MODEL}")
                summarize_day(date, progress=lambda p, label: self._set(date, progress=p, label=label))
                self._set(date, status="done")
                log(f"[summary] {date}: done")
            except Exception as e:
                log(f"[summary] {date} FAILED: {e}")
                self._set(date, status="failed", error=str(e))

    def watch(self, interval: int = 300):
        """Periodically checks for days that need summarizing and runs them."""
        def _watch():
            while True:
                if setting("auto_summarize") and not self._one_at_a_time.locked():
                    # Find days that have a transcript but no summary (or an outdated one)
                    for date in all_transcripts():
                        if not summary_path(date).is_file():
                            self.start(date)
                            break # Summarize one by one
                    # If all days are summarized, we could potentially trigger a global overview here
                    # But global overview is usually a separate manual action or a final step.
                time.sleep(interval)
        threading.Thread(target=_watch, daemon=True, name="summary-watch").start()


# --- MEETINGS: lines (or whole segments) the user marked, possibly across days ---
MEETINGS_LOCK = threading.RLock()

MEETING_CONTEXT = """You are summarising a meeting (or a group of related conversations) from a personal voice recorder.
Transcript lines look like: [L12] 2026-10-02 9:43 AM Speaker 2: text
The [L12] tag identifies the line. Speaker names are as written (some are placeholders like "Speaker 2").
The transcript comes from automatic speech recognition, so expect some mistakes; don't invent facts to fill gaps.
Only use what is in the transcript. Write in English."""

MEETING_FORMAT = """Write a status summary of the meeting in Markdown using exactly these sections, in this order. Leave out any
section that would be empty. Put the [L..] tag of the line(s) it came from at the end of every bullet.

## Overview
Two to four sentences: what the meeting was about and who took part.

## Where things stand
- topic or workstream: its status now (done, in progress, blocked, not started) and what happens next [L12]

## Decisions
- what was decided, and by whom [L20]

## Action items
- [ ] task (owner, due date if said) [L30]

## Open questions & risks
- unresolved question, blocker or concern [L40]

Rules: no preamble or closing remarks; refer to people by the names in the transcript; never cite a [L..] tag that
isn't in the transcript."""


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


def summarize_meeting(mid: str, progress=None) -> dict:
    m = get_meeting(mid)
    if m is None:
        raise RuntimeError("That meeting no longer exists.")
    marked, _ = meeting_lines(m)
    if not marked:
        raise RuntimeError("Add some lines to this meeting first.")
    lines, refs = [], {}
    for i, l in enumerate(marked, 1):
        refs[f"L{i}"] = {"date": l["date"], "start": l["start"], "at": l["at"]}
        lines.append(f"[L{i}] {l['date']} {l['at']} {l['speaker'].replace('_', ' ')}: {l['text']}")
    parts, cur = [], []
    for line in lines:
        if cur and sum(len(x) + 1 for x in cur) + len(line) > SUMMARY_CHUNK_CHARS:
            parts.append(cur)
            cur = []
        cur.append(line)
    parts.append(cur)
    head = f"Meeting \"{m['name']}\""
    if len(parts) == 1:
        if progress:
            progress(0.1, "Writing the summary")
        md = ollama_chat(f"{head}:\n\n" + "\n".join(parts[0]) + "\n\n" + MEETING_FORMAT, MEETING_CONTEXT,
                         on_token=lambda k: progress and progress(min(0.95, 0.1 + k / 1500), f"Writing the summary ({k} words so far)"))
    else:
        notes = []
        for n, part in enumerate(parts, 1):
            if progress:
                progress((n - 1) / (len(parts) + 1), f"Reading part {n} of {len(parts)}")
            notes.append(ollama_chat(
                f"Part {n} of {len(parts)} of {head}:\n\n" + "\n".join(part) +
                "\n\nWrite compact bullet-point notes on this part only: what each topic's status is, decisions, action items "
                "with owners, open questions. End every bullet with the [L..] tag(s) it came from, copied exactly. No preamble.",
                MEETING_CONTEXT, max_tokens=900))
        if progress:
            progress(len(parts) / (len(parts) + 1), "Writing the summary")
        md = ollama_chat(f"Notes on {head}, part by part in time order:\n\n" +
                         "\n\n".join(f"### Part {n}\n{t}" for n, t in enumerate(notes, 1)) +
                         "\n\nCombine these notes into one summary of the whole meeting (merge duplicates; keep the [L..] tags).\n\n" + MEETING_FORMAT,
                         MEETING_CONTEXT, max_tokens=2000)
    md = drop_empty_sections(md)
    used = {f"L{n}" for tag in re.findall(r"\[(L\d+(?:\s*[-\u2013,]\s*L?\d+)*)\]", md) for n in re.findall(r"\d+", tag)}
    result = {"markdown": md, "model": OLLAMA_MODEL, "created": time.time(), "fingerprint": meeting_fingerprint(marked),
              "refs": {r: refs[r] for r in used if r in refs}}

    def save(meetings):
        for x in meetings:
            if x["id"] == mid:
                x["summary"] = result
    update_meetings(save)
    return result


class MeetingSummarizer(Summarizer):
    """Same one-at-a-time background runner as day summaries (they share the model lock); keyed by meeting id."""

    def _run(self, mid: str):
        with self._one_at_a_time:
            self._set(mid, status="running", label="Starting the model (first time takes about a minute)")
            try:
                problems = ollama_problems()
                if problems:
                    raise RuntimeError(" ".join(problems))
                log(f"[meeting] {mid}: summarising with {OLLAMA_MODEL}")
                summarize_meeting(mid, progress=lambda p, label: self._set(mid, progress=p, label=label))
                self._set(mid, status="done")
            except Exception as e:
                log(f"[meeting] {mid} FAILED: {e}")
                self._set(mid, status="failed", error=str(e))


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
        self.blocked: dict | None = None            # {"date", "clips"}: waiting for the user to check levels
        self.unblock = threading.Event()

    def resolve(self, action: str):
        """The user dealt with a flagged clip: 'continue' (levels saved / accepted) or 'skip' the day."""
        with self.lock:
            if not self.blocked:
                return
            if action == "skip" and self.blocked["date"] in self.queue:
                self.queue.remove(self.blocked["date"])
            self.blocked = None
        self.unblock.set()

    def summary(self) -> dict:
        with self.lock:
            cur = self.current and {k: self.current[k] for k in ("date", "progress", "label")}
            return {"current": cur, "queued": list(self.queue), "blocked": self.blocked}

    def watch(self, interval: float = 30.0, settle: float = 60.0, force: bool = False):
        """Keep an eye on the recordings folder and queue any day that is new or incomplete.
        Days whose files changed in the last `settle` seconds are left alone (still copying)."""
        def snapshot(files):
            return tuple((f.name, f.stat().st_size) for f in files)

        def loop():
            first = True
            while True:
                try:
                    if not setting("auto_transcribe"):   # off until the user turns it on in setup/settings
                        time.sleep(5)
                        continue
                    now = time.time()
                    for date, files in sorted(get_daily_batches(INPUT_DIR).items()):
                        if any(now - f.stat().st_mtime < settle for f in files):
                            continue
                        # A day that failed is retried only once its recordings change (or from the UI)
                        if self.failed_state.get(date) == snapshot(files):
                            continue
                        if (first and force) or needs_processing(date, files):
                            # Never silently overwrite hand-edited lines: those days wait for a manual
                            # Re-transcribe, which warns first
                            if has_edits(date):
                                continue
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
            if self.blocked and self.blocked["date"] == date:
                return {"status": "blocked", "clips": self.blocked["clips"]}
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
                # A recording that's very quiet / clipped / noisy and hasn't been looked at stops the whole
                # queue until the user sets its levels in the viewer (or accepts it as is, or skips the day)
                self._set(label="Finding speech and checking audio levels")
                flagged = flagged_clips(day_segments(date, files), autofix=True)
                if flagged:
                    log(f"[viewer] {date}: waiting for levels on {', '.join(flagged)}")
                    with self.lock:
                        self.blocked = {"date": date, "clips": flagged}
                        self.queue.insert(0, date)
                        self.hints[date] = hint
                        self.current = None
                    self.unblock.clear()
                    self.unblock.wait()
                    continue
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
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles
    from fastapi.templating import Jinja2Templates
    from pydantic import BaseModel

    app = FastAPI(title="Recorder Playback", docs_url=None, redoc_url=None)
    app.mount("/static", StaticFiles(directory=SCRIPT_DIR / "static"), name="static")
    templates = Jinja2Templates(directory=SCRIPT_DIR / "templates")
    processor = Processor()

    def after_sync(days: list[str]):
        # Freshly copied days follow the auto-transcribe setting (queued now, not on the next watcher pass)
        if setting("auto_transcribe"):
            for d in days:
                processor.enqueue(d)

    syncer = Syncer(on_done=after_sync)
    syncer.watch()
    # Auto-sync: if enabled and a recorder with new files is plugged in at startup, start sync immediately.
    # This uses the normal syncer, so the progress UI will be visible to the user in the viewer.
    if setting("auto_sync"):
        recorders = find_recorders()
        if recorders:
            # Start sync for the first recorder that has new recordings
            for r in recorders:
                if r["new"] > 0:
                    syncer.start(r["root"])
                    break

    if auto_process:
        processor.watch(force=force)   # only queues work once auto-transcribe is switched on
    checks_cache: dict = {}

    class RenameBody(BaseModel):
        old: str
        new: str
        merge: bool = False

    class ProcessBody(BaseModel):
        # None = reuse the day's previous hint; {} = let it decide automatically
        hint: dict | None = None

    class LinesBody(BaseModel):
        action: str               # trash | restore | keep | replace
        items: list[dict]         # [{start, text}]
        new: list[dict] | None = None   # replace: the lines that take their place

    class ClipBody(BaseModel):
        start: float
        end: float
        text: str = ""

    class SettingsBody(BaseModel):
        setup_done: bool | None = None
        auto_transcribe: bool | None = None
        auto_sync: bool | None = None
        language: str | None = None
        rustle_strength: float | None = None

    class SyncBody(BaseModel):
        root: str

    class LevelsBody(BaseModel):
        levels: dict[str, dict]       # recording name -> {gain_db, sensitivity, rustle, gate_db, declip}
        reviewed: bool = True

    class BlockedBody(BaseModel):
        action: str                   # continue | skip

    def recording_path(name: str) -> Path:
        if not FILE_PATTERN.match(name):
            raise HTTPException(404, "Not a recording")
        return safe_file(INPUT_DIR, name, RECORDING_SUFFIXES)

    @app.get("/api/days/{date}/clips")
    def day_clips(date: str):
        """Every speech segment of the day with its levels, problems and waveform, for the levels dialog."""
        check_date(date)
        files = get_daily_batches(INPUT_DIR).get(date)
        if not files:
            raise HTTPException(404, f"No recordings for {date} in {INPUT_DIR}")
        clips = []
        for seg in day_segments(date, files):
            try:
                info = analyze_segment(seg)
            except RuntimeError as e:
                info = {"name": seg["key"], "duration": seg["duration"], "issues": [{"code": "unreadable", "label": "Unreadable", "detail": str(e)}],
                        "suggested": {}, "peaks": [], "rms": []}
            clips.append({**info, "recorded_at": seg["recorded_at"], "file": seg["file"], "levels": clip_levels(seg["key"])})
        return {"date": date, "clips": clips, "default_rustle": setting("rustle_strength"),
                "sensitivity_labels": {1: "Lowest", 2: "Low", 3: "Normal", 4: "High", 5: "Highest"}}

    @app.post("/api/levels")
    def put_levels(body: LevelsBody):
        save_levels(body.levels, body.reviewed)
        return {"saved": len(body.levels)}

    @app.post("/api/blocked")
    def resolve_blocked(body: BlockedBody):
        if body.action not in ("continue", "skip"):
            raise HTTPException(400, "Unknown action")
        processor.resolve(body.action)
        return processor.summary()

    @app.get("/api/clips/{name}/preview")
    def clip_preview(name: str, start: float = 0.0, gain_db: float = 0.0, gate_db: float | None = None,
                     rustle: float | None = None, declip: bool = False):
        """~10 s of the segment processed exactly as transcription will hear it (start = seconds into the segment)."""
        from fastapi.responses import Response
        found = segment_source(name)
        if found is None:
            raise HTTPException(404, "Not a segment")
        path, seg_start = found
        lv = {"gain_db": gain_db, "gate_db": gate_db, "rustle": rustle, "declip": declip}
        try:
            return Response(preview_wav(path, seg_start + max(0.0, start), lv), media_type="audio/wav", headers={"Cache-Control": "no-store"})
        except RuntimeError as e:
            raise HTTPException(500, str(e))

    def system_checks(fresh: bool = False) -> dict:
        """What setup needs: HF access, ffmpeg, GPU, recordings folder. Cached (the HF check is a web call)."""
        if fresh or time.time() - checks_cache.get("at", 0) > 600:
            problems = setup_problems()
            hf = [p for p in problems if "HF_TOKEN" in p] or (model_access_problems() if HF_TOKEN else [])
            gpu = None
            if shutil.which("nvidia-smi"):
                out = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                                     capture_output=True, text=True)
                gpu = out.stdout.strip().splitlines()[0] if out.returncode == 0 and out.stdout.strip() else None
            checks_cache.update(at=time.time(), checks={
                "hf": {"ok": not hf, "detail": " ".join(hf) or "Hugging Face models are accessible."},
                "ffmpeg": {"ok": shutil.which("ffmpeg") is not None,
                           "detail": "ffmpeg found." if shutil.which("ffmpeg") else "ffmpeg is not installed / not on PATH."},
                "gpu": {"ok": gpu is not None,
                        "detail": gpu or "No NVIDIA GPU found: transcription will run on the CPU (much slower)."},
                "record_dir": {"ok": INPUT_DIR.is_dir(), "detail": str(INPUT_DIR)},
            })
        return checks_cache["checks"]

    @app.get("/api/settings")
    def get_settings(fresh: bool = False):
        return {"settings": load_settings(), "checks": system_checks(fresh), "sync_mode": SYNC_MODE}

    @app.post("/api/settings")
    def put_settings(body: SettingsBody):
        saved = save_settings(body.model_dump(exclude_none=True))
        log(f"Settings saved: auto-transcribe {'on' if saved['auto_transcribe'] else 'off'}, "
            f"auto-sync {'on' if saved['auto_sync'] else 'off'}, "
            f"language {saved['language'] or 'auto'}, rustle {saved['rustle_strength']}")
        return {"settings": saved}

    @app.get("/api/sync")
    def sync_status():
        return {"recorders": find_recorders(), "job": syncer.status(), "mode": SYNC_MODE}

    @app.post("/api/sync")
    def sync_start(body: SyncBody):
        try:
            return syncer.start(body.root)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))

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
    def index(request: Request):
        # A version from the JS mtime keeps the browser from serving stale assets after edits
        version = int((SCRIPT_DIR / "static" / "viewer.js").stat().st_mtime)
        return templates.TemplateResponse(request, "viewer.html", {"version": version})

    @app.get("/api/library")
    def library():
        batches = get_daily_batches(INPUT_DIR)
        transcripts = dict(all_transcripts())
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
                    for s in (s for s in segs if not s.get("noise")):
                        talk[s.get("speaker")] = talk.get(s.get("speaker"), 0) + s["end"] - s["start"]
                    known = {r["name"] for r in transcript_recordings(data)}
                    src_total = sum(s.get("duration") or 0 for s in transcript_sources(data))
                    day.update({
                        "status": "ready",
                        "duration": round(src_total or (segs[-1]["end"] if segs else 0), 1),
                        "speakers": sorted(talk, key=talk.get, reverse=True),
                        "lines": len(segs),
                        "parts": part_count(transcripts[date]),
                        "recordings": max(len(files), len(known)),
                        "new_recordings": len({f.name for f in files} - known),
                        "edited": sum(1 for s in segs if s.get("edited")),
                        "needs_review": data.get("voices_reviewed") is False,   # older days have no flag: not nagged
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
        path = transcript_path(date)
        if path.is_file():
            data = resolve_overlap_names(json.loads(json.dumps(load_transcript(path))))  # copy; don't touch the cache
            audio = data.get("audio")
            # ?v= changes whenever the file is rebuilt, so the browser never plays a stale cached copy
            # (e.g. yesterday's 2-minute version of a day that now has a 35-minute recording too)
            ap = day_dir(date) / audio if audio else None
            data["audio_url"] = f"/audio/{date}/{audio}?v={int(ap.stat().st_mtime)}" if ap and ap.is_file() else None
            data["sources"] = transcript_sources(data)
            # The viewer only needs which lines taught whom, not the 256-number embeddings
            data["line_prints"] = [{"start": p["start"], "text": p["text"], "person": p["person"]}
                                   for p in data.get("line_prints", [])]
            data["parts"] = day_parts(data)
            data["status"] = "ready"
        else:
            files = get_daily_batches(INPUT_DIR).get(date)
            if not files:
                raise HTTPException(404, f"Nothing recorded on {date}")
            data = {"date": date, "status": "pending", "segments": [], "audio_url": None,
                    "sources": describe_sources(files)}
        for s in data["sources"]:
            rp = INPUT_DIR / s["name"]
            s["url"] = f"/recordings/{s['name']}?v={int(rp.stat().st_mtime)}" if rp.is_file() else None
        return data

    @app.get("/audio/{date}/{name}")
    def audio(date: str, name: str):
        check_date(date)
        return FileResponse(safe_file(day_dir(date), name, {".wav", ".mp3"}),   # supports Range, so seeking works
                            headers={"Cache-Control": "no-cache"})

    @app.get("/recordings/{name}")
    def recording(name: str):
        path = safe_file(INPUT_DIR, name, RECORDING_SUFFIXES)
        return FileResponse(path, media_type="audio/wav" if path.suffix.lower() == ".wav" else "audio/mpeg",
                            headers={"Cache-Control": "no-cache"})

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

    @app.post("/api/days/{date}/lines")
    def lines(date: str, body: LinesBody):
        check_date(date)
        if body.action not in ("trash", "restore", "keep", "replace"):
            raise HTTPException(400, "Unknown action")
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        items = [{"start": float(i["start"]), "text": str(i["text"])} for i in body.items if "start" in i and "text" in i]
        new = None
        if body.action == "replace":
            try:
                new = [{"start": round(float(n["start"]), 2), "end": round(float(n["end"]), 2),
                        "speaker": str(n["speaker"]).strip() or "Unknown", "text": str(n["text"]).strip(),
                        **({"edited": True} if n.get("edited") else {})}
                       for n in (body.new or [])]
            except (KeyError, TypeError, ValueError):
                raise HTTPException(400, "Each new line needs start, end, speaker and text")
            if any(not n["text"] or n["end"] < n["start"] for n in new):
                raise HTTPException(400, "A line can't be empty or end before it starts")
        try:
            return {"changed": edit_lines(date, items, body.action, new)}
        except ValueError as e:
            raise HTTPException(409, str(e))

    @app.post("/api/days/{date}/clip")
    def save_clip(date: str, body: ClipBody):
        """Cut [start, end] (seconds into the day) out of the ORIGINAL recording as an MP3 in <date>/clips/."""
        check_date(date)
        path = transcript_path(date)
        if not path.is_file():
            raise HTTPException(404, f"No transcript for {date}")
        sources = [s for s in transcript_sources(load_transcript(path)) if "start" in s]
        src = None
        for s in sources:
            if s["start"] <= body.start + 0.01:
                src = s
        if src is None:
            raise HTTPException(400, "Can't tell which recording that line came from")
        rec = recording_path(src.get("file") or src["name"])
        base = src.get("file_start", 0.0)   # segments start part-way into their recording
        # Padding keeps the first and last word from being clipped; stay inside the one recording the line is in
        a = max(0.0, body.start - src["start"] - CLIP_PAD_SECONDS)
        b = min(src["duration"], body.end - src["start"] + CLIP_PAD_SECONDS)
        if b - a < 0.2:
            raise HTTPException(400, "That clip is too short")
        clock = (src.get("recorded_at") or "00:00:00").split(":")
        t = int(clock[0]) * 3600 + int(clock[1]) * 60 + int(clock[2]) + int(a)
        words = re.sub(r"[^\w' -]+", "", body.text or "").split()
        label = " ".join(words[:6]).strip()
        stem = f"{date} {t // 3600:02d}-{t % 3600 // 60:02d}-{t % 60:02d}" + (f" {label}" if label else "")
        out_dir = day_dir(date) / "clips"
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{stem}.mp3"
        n = 2
        while out.exists():
            out = out_dir / f"{stem} ({n}).mp3"
            n += 1
        res = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{base + a:.3f}", "-t", f"{b - a:.3f}", "-i", str(rec),
                              "-vn", "-ac", "1", "-codec:a", "libmp3lame", "-q:a", "2", str(out)],
                             capture_output=True, text=True)
        if res.returncode != 0 or not out.is_file():
            out.unlink(missing_ok=True)
            raise HTTPException(500, f"ffmpeg couldn't cut the clip: {res.stderr.strip()[-200:]}")
        return {"name": out.name, "path": str(out), "seconds": round(b - a, 1)}

    @app.get("/api/speakers")
    def speakers():
        """Everyone the app knows (voice database + names used in transcripts), for the pickers."""
        conn = init_db()
        try:
            names = {r[0] for r in conn.execute("SELECT name FROM speakers")}
        finally:
            conn.close()
        names |= {p["name"] for p in people_summary()}
        tv = tv_names()
        names = {n for n in names if not n.startswith("Unknown") and n not in tv}
        return {"speakers": sorted(names, key=str.lower), "tv": sorted(tv, key=str.lower)}

    summarizer = Summarizer()
    summarizer.watch()

    def summary_state(date: str) -> dict:
        job = summarizer.state(date)
        out = {"status": job.get("status") if job.get("status") in ("queued", "running", "failed") else "none",
               "progress": job.get("progress"), "label": job.get("label"), "error": job.get("error"), "model": OLLAMA_MODEL}
        sp = summary_path(date)
        if sp.is_file():
            saved = json.loads(sp.read_text(encoding="utf-8"))
            tp = transcript_path(date)
            out.update({"markdown": drop_empty_sections(saved["markdown"]), "refs": saved.get("refs", {}), "created": saved.get("created"),
                        "model": saved.get("model"),
                        "outdated": tp.is_file() and saved.get("fingerprint") != transcript_fingerprint(load_transcript(tp))})
            if out["status"] == "none":
                out["status"] = "ready"
        return out

    @app.get("/api/days/{date}/summary")
    def get_summary(date: str):
        check_date(date)
        return summary_state(date)

    @app.post("/api/days/{date}/summary")
    def make_summary(date: str):
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, "Transcribe this day first")
        summarizer.start(date)
        return summary_state(date)

    @app.get("/api/people")
    def people():
        return {"people": people_summary()}

    extractor = Extractor(busy=lambda: bool(processor.current or processor.queue))

    @app.get("/api/overview")
    def get_overview(days: int = EXTRACT_DAYS):
        return {**overview_data(max(1, min(days, 400))), "extractor": extractor.state()}

    class ExtractBody(BaseModel):
        retry: bool = False

    @app.post("/api/overview/extract")
    def run_extract(body: ExtractBody | None = None):
        """Queue every day in the Overview window that has no (or an outdated) extraction, newest first."""
        todo = [d["date"] for d in overview_data()["days"] if d["extract"] != "ready"]
        extractor.enqueue(todo, retry=bool(body and body.retry))
        return {"queued": todo, "extractor": extractor.state()}

    class RelabelBody(BaseModel):
        old: str
        new: str
        lines: list[dict] | None = None   # only these lines (used by undo); default = all of `old`'s lines
        labels: list[str] | None = None   # which voices to move back (used by undo)

    @app.post("/api/days/{date}/relabel")
    def relabel(date: str, body: RelabelBody):
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        new = body.new.strip()
        if not new:
            raise HTTPException(400, "The name can't be empty")
        lines = [{"start": float(l["start"]), "text": str(l["text"])} for l in body.lines] if body.lines is not None else None
        changed = relabel_speaker(date, body.old, new, lines)
        labels, learned = teach_voice(date, body.old, new, body.labels)
        log(f"{date}: '{body.old}' is '{new}' on this day ({len(changed)} lines)"
            + (f"; {new}'s voice profile learned from it" if learned else ""))
        return {"changed": changed, "labels": labels, "learned": learned}

    class TvVoiceBody(BaseModel):
        speaker: str
        name: str   # the channel / show, e.g. "MKBHD"

    @app.post("/api/days/{date}/tv-voice")
    def tv_voice(date: str, body: TvVoiceBody):
        """This voice is a TV show / YouTuber: name it and learn its voice as a TV profile. Its lines stay
        (and any the user had hidden as "TV / music" come back), so facts can be pulled from them.
        Undo = voice-noise {noise: true, lines: shown} then relabel {old: name, new: speaker, lines, labels}."""
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        name = body.name.strip()
        if not name:
            raise HTTPException(400, "The name can't be empty")
        if name != body.speaker and name not in tv_names() and name in {p["name"] for p in people_summary()}:
            raise HTTPException(409, f"{name} is a person, not a TV voice")
        mark_tv(name)
        changed = relabel_speaker(date, body.speaker, name)
        labels, learned = teach_voice(date, body.speaker, name)
        with TRANSCRIPT_LOCK:
            path = transcript_path(date)
            data = json.loads(path.read_text(encoding="utf-8"))
            for v in data.get("voices", []):
                if v.get("label") in labels:
                    v["tv"] = True
            write_transcript(path, data)
        shown = mark_speaker_noise(date, name, False)
        log(f"{date}: '{body.speaker}' is TV '{name}'" + (f" ({len(shown)} hidden lines shown)" if shown else "")
            + ("; voice learned" if learned else ""))
        return {"changed": changed, "labels": labels, "shown": shown, "learned": learned}

    class SplitBody(BaseModel):
        speaker: str
        seeds: dict[str, list[dict]]   # person -> [{start, text}] lines the user tagged

    @app.post("/api/days/{date}/voice-split")
    def voice_split(date: str, body: SplitBody):
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        seeds = {p.strip(): [{"start": float(l["start"]), "text": str(l["text"])} for l in ls]
                 for p, ls in body.seeds.items() if p.strip() and ls}
        if not seeds:
            raise HTTPException(400, "Tag a few lines for each person first")
        try:
            lines = split_voice(date, body.speaker, seeds)
        except FileNotFoundError as e:
            raise HTTPException(400, str(e))
        log(f"{date}: split '{body.speaker}' into {', '.join(seeds)}: {len(lines)} lines suggested")
        return {"lines": lines}

    class TrainBody(BaseModel):
        person: str
        lines: list[dict]          # [{start, text}]
        remove: bool = False       # undo: forget these lines again

    @app.post("/api/days/{date}/voice-train")
    def voice_train(date: str, body: TrainBody):
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        lines = [{"start": float(l["start"]), "text": str(l["text"])} for l in body.lines if "start" in l and "text" in l]
        try:
            r = train_lines(date, body.person.strip(), lines, body.remove)
        except (ValueError, FileNotFoundError) as e:
            raise HTTPException(400, str(e))
        log(f"{date}: {body.person}'s voice {'un-taught' if body.remove else 'taught'} from "
            f"{len(lines if body.remove else r['trained'])} line(s)")
        return r

    class SimilarBody(BaseModel):
        person: str

    @app.post("/api/days/{date}/voice-similar")
    def voice_similar(date: str, body: SimilarBody):
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        try:
            return {"lines": similar_lines(date, body.person.strip())}
        except FileNotFoundError as e:
            raise HTTPException(400, str(e))

    class VoiceNoiseBody(BaseModel):
        speaker: str
        noise: bool = True
        lines: list[dict] | None = None   # only these lines (used by undo)

    @app.post("/api/days/{date}/voice-noise")
    def voice_noise(date: str, body: VoiceNoiseBody):
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        lines = [{"start": float(l["start"]), "text": str(l["text"])} for l in body.lines] if body.lines is not None else None
        changed = mark_speaker_noise(date, body.speaker, body.noise, lines)
        log(f"{date}: '{body.speaker}' {'hidden as noise' if body.noise else 'shown again'} ({len(changed)} lines)")
        return {"changed": changed}

    class ReviewedBody(BaseModel):
        reviewed: bool = True

    @app.post("/api/days/{date}/voices/reviewed")
    def voices_reviewed(date: str, body: ReviewedBody):
        check_date(date)
        path = transcript_path(date)
        if not path.is_file():
            raise HTTPException(404, f"No transcript for {date}")
        with TRANSCRIPT_LOCK:
            data = json.loads(path.read_text(encoding="utf-8"))
            data["voices_reviewed"] = body.reviewed
            write_transcript(path, data)
        return {"reviewed": body.reviewed}

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

    @app.get("/api/voices")
    def voices():
        return {"profiles": voice_profiles()}

    @app.delete("/api/voices/prints/{pid}")
    def remove_print(pid: int):
        name = delete_voiceprint(pid)
        if name is None:
            raise HTTPException(404, "That sample is already gone")
        log(f"Removed one voice sample from '{name}'")
        return {"name": name}

    class ProfileBody(BaseModel):
        name: str
        tv: bool | None = None

    @app.post("/api/voices/kind")
    def profile_kind(body: ProfileBody):
        set_profile_kind(body.name, bool(body.tv))
        log(f"'{body.name}' is now {'a TV / YouTube voice' if body.tv else 'a person'}")
        return {"ok": True}

    @app.post("/api/voices/delete")
    def remove_profile(body: ProfileBody):
        if not delete_profile(body.name):
            raise HTTPException(404, f"No voice profile called {body.name}")
        log(f"Deleted voice profile '{body.name}' (transcripts unchanged)")
        return {"ok": True}

    class MeetingBody(BaseModel):
        name: str = ""
        items: list[dict] = []

    class MeetingItemsBody(BaseModel):
        add: list[dict] = []
        remove: list[dict] = []

    meeting_summarizer = MeetingSummarizer()

    def meeting_or_404(mid: str) -> dict:
        m = get_meeting(mid)
        if m is None:
            raise HTTPException(404, "No such meeting")
        return m

    def meeting_summary_state(m: dict) -> dict:
        job = meeting_summarizer.state(m["id"])
        out = {"status": job.get("status") if job.get("status") in ("queued", "running", "failed") else "none",
               "progress": job.get("progress"), "label": job.get("label"), "error": job.get("error"), "model": OLLAMA_MODEL}
        saved = m.get("summary")
        if saved:
            lines, _ = meeting_lines(m)
            out.update({"markdown": drop_empty_sections(saved["markdown"]), "refs": saved.get("refs", {}),
                        "created": saved.get("created"), "model": saved.get("model"),
                        "outdated": saved.get("fingerprint") != meeting_fingerprint(lines)})
            if out["status"] == "none":
                out["status"] = "ready"
        return out

    @app.get("/api/meetings")
    def list_meetings():
        return {"meetings": sorted((meeting_facts(m) for m in load_meetings()),
                                   key=lambda f: (f["first"]["date"], f["first"]["start"]) if f["first"] else ("", 0), reverse=True)}

    @app.post("/api/meetings")
    def create_meeting(body: MeetingBody):
        m = {"id": uuid.uuid4().hex[:8], "name": body.name.strip()[:120] or "Untitled meeting", "created": time.time(),
             "items": clean_meeting_items(body.items)}
        update_meetings(lambda ms: ms.append(m))
        log(f"Meeting '{m['name']}' created with {len(m['items'])} line(s)")
        return meeting_facts(m)

    @app.get("/api/meetings/{mid}")
    def read_meeting(mid: str):
        m = meeting_or_404(mid)
        lines, _ = meeting_lines(m)
        return {**meeting_facts(m), "transcript": lines, "summary_state": meeting_summary_state(m)}

    @app.post("/api/meetings/{mid}/items")
    def change_meeting_items(mid: str, body: MeetingItemsBody):
        meeting_or_404(mid)
        add, remove = clean_meeting_items(body.add), clean_meeting_items(body.remove)
        near = lambda a, b: a["date"] == b["date"] and abs(a["start"] - b["start"]) < 0.02

        def change(meetings):
            m = next((x for x in meetings if x["id"] == mid), None)
            if m is None:
                return None
            m["items"] = [i for i in m["items"] if not any(near(i, r) for r in remove)]
            m["items"] += [a for a in add if not any(near(i, a) for i in m["items"])]
            return m
        m = update_meetings(change)
        if m is None:
            raise HTTPException(404, "No such meeting")
        return meeting_facts(m)

    @app.post("/api/meetings/{mid}/rename")
    def rename_meeting(mid: str, body: MeetingBody):
        name = body.name.strip()[:120]
        if not name:
            raise HTTPException(400, "A meeting needs a name")

        def rename_it(meetings):
            for m in meetings:
                if m["id"] == mid:
                    m["name"] = name
                    return True
            return False
        if not update_meetings(rename_it):
            raise HTTPException(404, "No such meeting")
        return {"name": name}

    @app.delete("/api/meetings/{mid}")
    def delete_meeting(mid: str):
        def drop(meetings):
            before = len(meetings)
            meetings[:] = [m for m in meetings if m["id"] != mid]
            return len(meetings) < before
        return {"deleted": update_meetings(drop)}

    @app.post("/api/meetings/{mid}/summary")
    def make_meeting_summary(mid: str):
        m = meeting_or_404(mid)
        meeting_summarizer.start(mid)
        return meeting_summary_state(m)

    return app


def serve(host: str, port: int, open_browser: bool = True, auto_process: bool = True, force: bool = False):
    import webbrowser
    import uvicorn

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    url = f"http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{port}"
    log(f"\nViewer running at {url}  (Ctrl+C to stop)")
    if host == "0.0.0.0":
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
