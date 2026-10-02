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
import sys
import argparse

from dotenv import load_dotenv

load_dotenv()

from core.config import log
from pipeline.batch import process_all
from pipeline.checks import setup_problems
from storage import list_speakers
from transcripts.people import rename_speaker


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
        from web.server import serve   # fastapi/uvicorn only load when serving
        serve(args.host, args.port, not args.no_browser, auto_process=not args.serve, force=args.force)
