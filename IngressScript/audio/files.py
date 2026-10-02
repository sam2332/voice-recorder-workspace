"""Recordings on disk: grouping by day, wall-clock times, cached durations."""
import subprocess
from pathlib import Path

from core.config import FILE_PATTERN, MIN_RECORDING_SECONDS

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
