"""Reading and writing <date>/transcript.json (cached, locked, atomic), and wiring voice_memory."""
import json
import threading
from pathlib import Path

from app_config import DB_PATH, HF_TOKEN
from audio.files import describe_sources
from audio.segments import day_parts
from core.config import INPUT_DIR, log
from core.paths import all_transcripts, day_dir, transcript_path
from voice_memory import configure

_transcript_cache: dict[str, tuple[float, dict]] = {}

TRANSCRIPT_LOCK = threading.RLock()   # the viewer edits transcripts while the worker may be writing one

def write_transcript(path: Path, data: dict):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)

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
