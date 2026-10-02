"""Meetings: create, change, rename, delete, summarise."""
import time
import uuid

from fastapi import APIRouter, HTTPException

from core.config import log
from llm.markdown import drop_empty_sections
from llm.ollama import OLLAMA_MODEL
from meetings.store import clean_meeting_items, get_meeting, load_meetings, meeting_facts, meeting_fingerprint, meeting_lines, update_meetings
from meetings.summary import MeetingSummarizer
from web.models import MeetingBody, MeetingItemsBody


def build(ctx) -> APIRouter:
    router = APIRouter()

    meeting_summarizer = MeetingSummarizer()

    def meeting_or_404(mid: str) -> dict:
        m = get_meeting(mid)
        if m is None:
            raise HTTPException(404, "No such meeting")
        return m

    def meeting_summary_state(m: dict) -> dict:
        job = meeting_summarizer.state(m["id"])
        out = {"status": job.get("status") if job.get("status") in ("queued", "running", "failed") else "none",
               "progress": job.get("progress"), "label": job.get("label"), "error": job.get("error"), "model": OLLAMA_MODEL}
        saved = m.get("summary")
        if saved:
            lines, _ = meeting_lines(m)
            out.update({"markdown": drop_empty_sections(saved["markdown"]), "refs": saved.get("refs", {}),
                        "created": saved.get("created"), "model": saved.get("model"),
                        "outdated": saved.get("fingerprint") != meeting_fingerprint(lines)})
            if out["status"] == "none":
                out["status"] = "ready"
        return out

    @router.get("/api/meetings")
    def list_meetings():
        return {"meetings": sorted((meeting_facts(m) for m in load_meetings()),
                                   key=lambda f: (f["first"]["date"], f["first"]["start"]) if f["first"] else ("", 0), reverse=True)}

    @router.post("/api/meetings")
    def create_meeting(body: MeetingBody):
        m = {"id": uuid.uuid4().hex[:8], "name": body.name.strip()[:120] or "Untitled meeting", "created": time.time(),
             "items": clean_meeting_items(body.items)}
        update_meetings(lambda ms: ms.append(m))
        log(f"Meeting '{m['name']}' created with {len(m['items'])} line(s)")
        return meeting_facts(m)

    @router.get("/api/meetings/{mid}")
    def read_meeting(mid: str):
        m = meeting_or_404(mid)
        lines, _ = meeting_lines(m)
        return {**meeting_facts(m), "transcript": lines, "summary_state": meeting_summary_state(m)}

    @router.post("/api/meetings/{mid}/items")
    def change_meeting_items(mid: str, body: MeetingItemsBody):
        meeting_or_404(mid)
        add, remove = clean_meeting_items(body.add), clean_meeting_items(body.remove)
        near = lambda a, b: a["date"] == b["date"] and abs(a["start"] - b["start"]) < 0.02

        def change(meetings):
            m = next((x for x in meetings if x["id"] == mid), None)
            if m is None:
                return None
            m["items"] = [i for i in m["items"] if not any(near(i, r) for r in remove)]
            m["items"] += [a for a in add if not any(near(i, a) for i in m["items"])]
            return m
        m = update_meetings(change)
        if m is None:
            raise HTTPException(404, "No such meeting")
        return meeting_facts(m)

    @router.post("/api/meetings/{mid}/rename")
    def rename_meeting(mid: str, body: MeetingBody):
        name = body.name.strip()[:120]
        if not name:
            raise HTTPException(400, "A meeting needs a name")

        def rename_it(meetings):
            for m in meetings:
                if m["id"] == mid:
                    m["name"] = name
                    return True
            return False
        if not update_meetings(rename_it):
            raise HTTPException(404, "No such meeting")
        return {"name": name}

    @router.delete("/api/meetings/{mid}")
    def delete_meeting(mid: str):
        def drop(meetings):
            before = len(meetings)
            meetings[:] = [m for m in meetings if m["id"] != mid]
            return len(meetings) < before
        return {"deleted": update_meetings(drop)}

    @router.post("/api/meetings/{mid}/summary")
    def make_meeting_summary(mid: str):
        m = meeting_or_404(mid)
        meeting_summarizer.start(mid)
        return meeting_summary_state(m)

    return router
