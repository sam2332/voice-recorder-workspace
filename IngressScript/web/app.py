"""The viewer app: starts the background workers and mounts one router per area."""
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from core.config import SCRIPT_DIR
from core.settings import setting
from llm.workers import Extractor, Summarizer
from pipeline.processor import Processor
from recorder_sync.recorders import find_recorders
from recorder_sync.syncer import Syncer
from web import (routes_days, routes_levels, routes_lines, routes_meetings, routes_people, routes_settings,
                 routes_summary, routes_voices)


def create_app(auto_process: bool = False, force: bool = False):
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
    summarizer = Summarizer()
    summarizer.watch()
    extractor = Extractor(busy=lambda: bool(processor.current or processor.queue))

    ctx = SimpleNamespace(processor=processor, syncer=syncer, summarizer=summarizer, extractor=extractor,
                          templates=templates, auto_process=auto_process)
    for routes in (routes_levels, routes_settings, routes_days, routes_lines, routes_people, routes_summary,
                   routes_voices, routes_meetings):
        app.include_router(routes.build(ctx))
    return app
