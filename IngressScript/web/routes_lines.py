"""Editing a day's lines, and saving a clip of the original recording."""
import re
import subprocess

from fastapi import APIRouter, HTTPException

from core.config import CLIP_PAD_SECONDS
from core.paths import day_dir, transcript_path
from transcripts.edits import edit_lines
from transcripts.store import load_transcript, transcript_sources
from web.deps import check_date, recording_path
from web.models import ClipBody, LinesBody


def build(ctx) -> APIRouter:
    router = APIRouter()

    @router.post("/api/days/{date}/lines")
    def lines(date: str, body: LinesBody):
        check_date(date)
        if body.action not in ("trash", "restore", "keep", "replace"):
            raise HTTPException(400, "Unknown action")
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        items = [{"start": float(i["start"]), "text": str(i["text"])} for i in body.items if "start" in i and "text" in i]
        new = None
        if body.action == "replace":
            try:
                new = [{"start": round(float(n["start"]), 2), "end": round(float(n["end"]), 2),
                        "speaker": str(n["speaker"]).strip() or "Unknown", "text": str(n["text"]).strip(),
                        **({"edited": True} if n.get("edited") else {})}
                       for n in (body.new or [])]
            except (KeyError, TypeError, ValueError):
                raise HTTPException(400, "Each new line needs start, end, speaker and text")
            if any(not n["text"] or n["end"] < n["start"] for n in new):
                raise HTTPException(400, "A line can't be empty or end before it starts")
        try:
            return {"changed": edit_lines(date, items, body.action, new)}
        except ValueError as e:
            raise HTTPException(409, str(e))

    @router.post("/api/days/{date}/clip")
    def save_clip(date: str, body: ClipBody):
        """Cut [start, end] (seconds into the day) out of the ORIGINAL recording as an MP3 in <date>/clips/."""
        check_date(date)
        path = transcript_path(date)
        if not path.is_file():
            raise HTTPException(404, f"No transcript for {date}")
        sources = [s for s in transcript_sources(load_transcript(path)) if "start" in s]
        src = None
        for s in sources:
            if s["start"] <= body.start + 0.01:
                src = s
        if src is None:
            raise HTTPException(400, "Can't tell which recording that line came from")
        rec = recording_path(src.get("file") or src["name"])
        base = src.get("file_start", 0.0)   # segments start part-way into their recording
        # Padding keeps the first and last word from being clipped; stay inside the one recording the line is in
        a = max(0.0, body.start - src["start"] - CLIP_PAD_SECONDS)
        b = min(src["duration"], body.end - src["start"] + CLIP_PAD_SECONDS)
        if b - a < 0.2:
            raise HTTPException(400, "That clip is too short")
        clock = (src.get("recorded_at") or "00:00:00").split(":")
        t = int(clock[0]) * 3600 + int(clock[1]) * 60 + int(clock[2]) + int(a)
        words = re.sub(r"[^\w' -]+", "", body.text or "").split()
        label = " ".join(words[:6]).strip()
        stem = f"{date} {t // 3600:02d}-{t % 3600 // 60:02d}-{t % 60:02d}" + (f" {label}" if label else "")
        out_dir = day_dir(date) / "clips"
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{stem}.mp3"
        n = 2
        while out.exists():
            out = out_dir / f"{stem} ({n}).mp3"
            n += 1
        res = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{base + a:.3f}", "-t", f"{b - a:.3f}", "-i", str(rec),
                              "-vn", "-ac", "1", "-codec:a", "libmp3lame", "-q:a", "2", str(out)],
                             capture_output=True, text=True)
        if res.returncode != 0 or not out.is_file():
            out.unlink(missing_ok=True)
            raise HTTPException(500, f"ffmpeg couldn't cut the clip: {res.stderr.strip()[-200:]}")
        return {"name": out.name, "path": str(out), "seconds": round(b - a, 1)}

    return router
