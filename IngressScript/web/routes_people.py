"""Speakers, people and stored voice profiles."""
from fastapi import APIRouter, HTTPException

from core.config import log
from storage import init_db
from transcripts.people import people_summary
from voice_memory import delete_profile, delete_voiceprint, NameTaken, rename_speaker_core, RenameError, set_profile_kind, tv_names, voice_profiles
from web.models import ProfileBody, RenameBody


def build(ctx) -> APIRouter:
    router = APIRouter()

    @router.get("/api/speakers")
    def speakers():
        """Everyone the app knows (voice database + names used in transcripts), for the pickers."""
        conn = init_db()
        try:
            names = {r[0] for r in conn.execute("SELECT name FROM speakers")}
        finally:
            conn.close()
        names |= {p["name"] for p in people_summary()}
        tv = tv_names()
        names = {n for n in names if not n.startswith("Unknown") and n not in tv}
        return {"speakers": sorted(names, key=str.lower), "tv": sorted(tv, key=str.lower)}

    @router.get("/api/people")
    def people():
        return {"people": people_summary()}

    @router.post("/api/speakers/rename")
    def rename(body: RenameBody):
        try:
            updated = rename_speaker_core(body.old, body.new, body.merge)
        except NameTaken as e:
            raise HTTPException(409, str(e))
        except RenameError as e:
            raise HTTPException(400, str(e))
        log(f"{'Merged' if body.merge else 'Renamed'} '{body.old}' -> '{body.new}' (updated {updated} transcript(s)).")
        return {"updated": updated}

    @router.get("/api/voices")
    def voices():
        return {"profiles": voice_profiles()}

    @router.delete("/api/voices/prints/{pid}")
    def remove_print(pid: int):
        name = delete_voiceprint(pid)
        if name is None:
            raise HTTPException(404, "That sample is already gone")
        log(f"Removed one voice sample from '{name}'")
        return {"name": name}

    @router.post("/api/voices/kind")
    def profile_kind(body: ProfileBody):
        set_profile_kind(body.name, bool(body.tv))
        log(f"'{body.name}' is now {'a TV / YouTube voice' if body.tv else 'a person'}")
        return {"ok": True}

    @router.post("/api/voices/delete")
    def remove_profile(body: ProfileBody):
        if not delete_profile(body.name):
            raise HTTPException(404, f"No voice profile called {body.name}")
        log(f"Deleted voice profile '{body.name}' (transcripts unchanged)")
        return {"ok": True}

    return router
