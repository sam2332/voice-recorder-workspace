"""Day summaries and the Overview extraction."""
import json

from fastapi import APIRouter, HTTPException

from core.paths import transcript_path
from llm.extract import EXTRACT_DAYS, overview_data
from llm.markdown import drop_empty_sections
from llm.ollama import OLLAMA_MODEL
from llm.summary import summary_path, transcript_fingerprint
from transcripts.store import load_transcript
from web.deps import check_date
from web.models import ExtractBody


def build(ctx) -> APIRouter:
    router = APIRouter()
    summarizer = ctx.summarizer
    extractor = ctx.extractor

    def summary_state(date: str) -> dict:
        job = summarizer.state(date)
        out = {"status": job.get("status") if job.get("status") in ("queued", "running", "failed") else "none",
               "progress": job.get("progress"), "label": job.get("label"), "error": job.get("error"), "model": OLLAMA_MODEL}
        sp = summary_path(date)
        if sp.is_file():
            saved = json.loads(sp.read_text(encoding="utf-8"))
            tp = transcript_path(date)
            out.update({"markdown": drop_empty_sections(saved["markdown"]), "refs": saved.get("refs", {}), "created": saved.get("created"),
                        "model": saved.get("model"),
                        "outdated": tp.is_file() and saved.get("fingerprint") != transcript_fingerprint(load_transcript(tp))})
            if out["status"] == "none":
                out["status"] = "ready"
        return out

    @router.get("/api/days/{date}/summary")
    def get_summary(date: str):
        check_date(date)
        return summary_state(date)

    @router.post("/api/days/{date}/summary")
    def make_summary(date: str):
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, "Transcribe this day first")
        summarizer.start(date)
        return summary_state(date)

    @router.get("/api/overview")
    def get_overview(days: int = EXTRACT_DAYS):
        return {**overview_data(max(1, min(days, 400))), "extractor": extractor.state()}

    @router.post("/api/overview/extract")
    def run_extract(body: ExtractBody | None = None):
        """Queue every day in the Overview window that has no (or an outdated) extraction, newest first."""
        todo = [d["date"] for d in overview_data()["days"] if d["extract"] != "ready"]
        extractor.enqueue(todo, retry=bool(body and body.retry))
        return {"queued": todo, "extractor": extractor.state()}

    return router
