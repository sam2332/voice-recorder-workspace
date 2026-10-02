"""Shared configuration for the voice-memory subsystem.

Paths and tokens live here (imported by both `app.py` and the `voice_memory`
package) so the voice modules never have to import `app.py` back, which would
create a circular import. Voice-specific thresholds also live here; app-level
constants stay in `app.py`.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()   # HF_TOKEN etc. must be read from .env regardless of import order

SCRIPT_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("SPEAKER_DB", SCRIPT_DIR / "speaker_memory.db"))
HF_TOKEN = os.getenv("HF_TOKEN")   # HuggingFace token for pyannote models

# Speaker matching. Voiceprints are the diarization pipeline's own per-speaker centroids
# (wespeaker embeddings averaged over each speaker's clean, non-overlapping speech).
MATCH_THRESHOLD = 0.68             # Similarity needed to name a voice automatically as a known person
SUGGEST_THRESHOLD = 0.45           # Weaker matches are only offered as suggestions in the viewer
MIN_VOICE_SECONDS = 20.0           # Voices with less speech than this are never enrolled as a new person
MAX_VOICEPRINTS = 40               # Stored voiceprints kept per person (oldest dropped)

# Line voices (teach a voice from single lines the user moved to someone). Same wespeaker
# model the diarization centroids come from, so line embeddings score directly against stored
# voiceprints. Lines of 2 s+ score 0.6-0.9 against their own person; ~1 s lines are unreliable
# (0.2-0.5), so they are never learned from.
MIN_TRAIN_LINE_SECONDS = 2.0       # Shorter lines are too little audio to learn a voice from
LINE_MATCH_THRESHOLD = 0.45        # A line "sounds like" a person at or above this similarity...
LINE_MATCH_MARGIN = 0.2            # ...and this much closer to them than to whoever it's assigned to now
LINE_STRONG_MATCH = 0.6            # Pre-ticked in the viewer
MAX_LINE_SUGGESTIONS = 40

# Splitting a mixed voice. Calibrated on a scratch copy of 2026-09-30: 0.35/0.05 suggested
# 451 of 782 lines (449 right); 6 tags each: 623, 618 right. Quiet voices score lower.
SPLIT_MIN_SECONDS = 1.5      # Shorter lines are left for the user to sort by ear
SPLIT_MATCH = 0.35           # A line is suggested for a person at or above this...
SPLIT_MARGIN = 0.05          # ...and this far ahead of the next person
SPLIT_STRONG = 0.55          # Strong suggestions (accepted in bulk) need this score...
SPLIT_STRONG_MARGIN = 0.15   # ...and this margin
