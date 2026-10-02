"""Paths, thresholds and file patterns shared by the whole app. Env vars only seed these."""
import os
import re
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()   # RECORD_DIR, OUTPUT_DIR etc. may come from .env

SCRIPT_DIR = Path(__file__).resolve().parent.parent   # IngressScript/

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

SEGMENT_KEY_RE = re.compile(r"^(V\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}[^@]*)@(\d+)$")
