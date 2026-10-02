"""Per-recording levels: analysis for the levels dialog, saving, previews, and the blocked-queue answer."""
from fastapi import APIRouter, HTTPException

from audio.analysis import analyze_segment, preview_wav
from audio.files import get_daily_batches
from audio.levels import clip_levels, save_levels
from audio.segments import day_segments, segment_source
from core.config import INPUT_DIR
from core.settings import setting
from web.deps import check_date
from web.models import BlockedBody, LevelsBody


def build(ctx) -> APIRouter:
    router = APIRouter()
    processor = ctx.processor

    @router.get("/api/days/{date}/clips")
    def day_clips(date: str):
        """Every speech segment of the day with its levels, problems and waveform, for the levels dialog."""
        check_date(date)
        files = get_daily_batches(INPUT_DIR).get(date)
        if not files:
            raise HTTPException(404, f"No recordings for {date} in {INPUT_DIR}")
        clips = []
        for seg in day_segments(date, files):
            try:
                info = analyze_segment(seg)
            except RuntimeError as e:
                info = {"name": seg["key"], "duration": seg["duration"], "issues": [{"code": "unreadable", "label": "Unreadable", "detail": str(e)}],
                        "suggested": {}, "peaks": [], "rms": []}
            clips.append({**info, "recorded_at": seg["recorded_at"], "file": seg["file"], "levels": clip_levels(seg["key"])})
        return {"date": date, "clips": clips, "default_rustle": setting("rustle_strength"),
                "sensitivity_labels": {1: "Lowest", 2: "Low", 3: "Normal", 4: "High", 5: "Highest"}}

    @router.post("/api/levels")
    def put_levels(body: LevelsBody):
        save_levels(body.levels, body.reviewed)
        return {"saved": len(body.levels)}

    @router.post("/api/blocked")
    def resolve_blocked(body: BlockedBody):
        if body.action not in ("continue", "skip"):
            raise HTTPException(400, "Unknown action")
        processor.resolve(body.action)
        return processor.summary()

    @router.get("/api/clips/{name}/preview")
    def clip_preview(name: str, start: float = 0.0, gain_db: float = 0.0, gate_db: float | None = None,
                     rustle: float | None = None, declip: bool = False):
        """~10 s of the segment processed exactly as transcription will hear it (start = seconds into the segment)."""
        from fastapi.responses import Response
        found = segment_source(name)
        if found is None:
            raise HTTPException(404, "Not a segment")
        path, seg_start = found
        lv = {"gain_db": gain_db, "gate_db": gate_db, "rustle": rustle, "declip": declip}
        try:
            return Response(preview_wav(path, seg_start + max(0.0, start), lv), media_type="audio/wav", headers={"Cache-Control": "no-store"})
        except RuntimeError as e:
            raise HTTPException(500, str(e))

    return router
