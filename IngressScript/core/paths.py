"""Where each day's files live under OUTPUT_DIR. Always go through these, never build paths by hand."""
from pathlib import Path

from core.config import DATE_RE, OUTPUT_DIR

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
