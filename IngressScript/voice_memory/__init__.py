"""Voice memory: turns diarization centroids into named people across days.

`app.py` injects the paths, helpers and lock it owns through `configure()`, so
this package never imports `app.py` back (which would be circular). Heavy model
imports (torch / pyannote / scipy) stay lazy inside `teaching.LineVoices`.
"""
from ._state import configure
from .memory import VoiceMemory, forget_unused_speakers, unit
from .profiles import (tv_names, mark_tv, voice_profiles, delete_voiceprint,
                       delete_profile, set_profile_kind)
from .teaching import (LineVoices, teach_voice, train_lines, similar_lines,
                       restore_line_prints)
from .split import split_voice
from .rename import RenameError, NameTaken, rename_speaker_core, rename_in_overlaps

__all__ = [
    "configure",
    "unit", "VoiceMemory", "forget_unused_speakers",
    "tv_names", "mark_tv", "voice_profiles", "delete_voiceprint",
    "delete_profile", "set_profile_kind",
    "LineVoices", "teach_voice", "train_lines", "similar_lines", "restore_line_prints",
    "split_voice",
    "RenameError", "NameTaken", "rename_speaker_core", "rename_in_overlaps",
]
