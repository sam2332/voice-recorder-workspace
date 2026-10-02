"""The page itself, the library, one day, its audio, and queueing days for transcription."""
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from audio.files import describe_sources, get_daily_batches, probe_duration, recorded_at
from audio.segments import day_parts
from core.config import DATE_RE, INPUT_DIR, RECORDING_SUFFIXES, SCRIPT_DIR
from core.paths import all_transcripts, day_dir, transcript_path
from transcripts.edits import resolve_overlap_names
from transcripts.store import load_transcript, part_count, transcript_recordings, transcript_sources
from web.deps import check_date, safe_file
from web.models import ProcessBody


def build(ctx) -> APIRouter:
    router = APIRouter()
    processor = ctx.processor
    templates = ctx.templates
    auto_process = ctx.auto_process

    @router.get("/")
    def index(request: Request):
        # A version from the JS mtime keeps the browser from serving stale assets after edits
        version = int((SCRIPT_DIR / "static" / "viewer.js").stat().st_mtime)
        return templates.TemplateResponse(request, "viewer.html", {"version": version})

    @router.get("/api/library")
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

    @router.get("/api/days/{date}")
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

    @router.get("/audio/{date}/{name}")
    def audio(date: str, name: str):
        check_date(date)
        return FileResponse(safe_file(day_dir(date), name, {".wav", ".mp3"}),   # supports Range, so seeking works
                            headers={"Cache-Control": "no-cache"})

    @router.get("/recordings/{name}")
    def recording(name: str):
        path = safe_file(INPUT_DIR, name, RECORDING_SUFFIXES)
        return FileResponse(path, media_type="audio/wav" if path.suffix.lower() == ".wav" else "audio/mpeg",
                            headers={"Cache-Control": "no-cache"})

    @router.post("/api/days/{date}/process")
    def process(date: str, body: ProcessBody | None = None):
        check_date(date)
        if date not in get_daily_batches(INPUT_DIR):
            raise HTTPException(404, f"No recordings for {date} in {INPUT_DIR}")
        processor.enqueue(date, body.hint if body else None)
        return processor.state_for(date) or {}

    @router.delete("/api/days/{date}/process")
    def cancel(date: str):
        check_date(date)
        if not processor.cancel(date):
            raise HTTPException(409, "Only queued days can be cancelled; a running day finishes first.")
        return {"cancelled": True}

    return router
