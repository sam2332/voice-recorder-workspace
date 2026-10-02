"""Which days need (re)processing, and the terminal batch run (--no-serve)."""
import sys
from pathlib import Path

from audio.files import get_daily_batches
from core.config import INPUT_DIR, log, OUTPUT_DIR
from core.paths import transcript_path
from pipeline.checks import model_access_problems, setup_problems
from pipeline.engine import Engine
from transcripts.store import load_transcript, transcript_recordings

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
