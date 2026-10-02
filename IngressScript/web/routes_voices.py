"""Naming, teaching, splitting and hiding the voices of one day."""
import json

from fastapi import APIRouter, HTTPException

from core.config import log
from core.paths import transcript_path
from transcripts.edits import mark_speaker_noise, relabel_speaker
from transcripts.people import people_summary
from transcripts.store import TRANSCRIPT_LOCK, write_transcript
from voice_memory import mark_tv, similar_lines, split_voice, teach_voice, train_lines, tv_names
from web.deps import check_date
from web.models import RelabelBody, ReviewedBody, SimilarBody, SplitBody, TrainBody, TvVoiceBody, VoiceNoiseBody


def build(ctx) -> APIRouter:
    router = APIRouter()

    @router.post("/api/days/{date}/relabel")
    def relabel(date: str, body: RelabelBody):
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        new = body.new.strip()
        if not new:
            raise HTTPException(400, "The name can't be empty")
        lines = [{"start": float(l["start"]), "text": str(l["text"])} for l in body.lines] if body.lines is not None else None
        changed = relabel_speaker(date, body.old, new, lines)
        labels, learned = teach_voice(date, body.old, new, body.labels)
        log(f"{date}: '{body.old}' is '{new}' on this day ({len(changed)} lines)"
            + (f"; {new}'s voice profile learned from it" if learned else ""))
        return {"changed": changed, "labels": labels, "learned": learned}

    @router.post("/api/days/{date}/tv-voice")
    def tv_voice(date: str, body: TvVoiceBody):
        """This voice is a TV show / YouTuber: name it and learn its voice as a TV profile. Its lines stay
        (and any the user had hidden as "TV / music" come back), so facts can be pulled from them.
        Undo = voice-noise {noise: true, lines: shown} then relabel {old: name, new: speaker, lines, labels}."""
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        name = body.name.strip()
        if not name:
            raise HTTPException(400, "The name can't be empty")
        if name != body.speaker and name not in tv_names() and name in {p["name"] for p in people_summary()}:
            raise HTTPException(409, f"{name} is a person, not a TV voice")
        mark_tv(name)
        changed = relabel_speaker(date, body.speaker, name)
        labels, learned = teach_voice(date, body.speaker, name)
        with TRANSCRIPT_LOCK:
            path = transcript_path(date)
            data = json.loads(path.read_text(encoding="utf-8"))
            for v in data.get("voices", []):
                if v.get("label") in labels:
                    v["tv"] = True
            write_transcript(path, data)
        shown = mark_speaker_noise(date, name, False)
        log(f"{date}: '{body.speaker}' is TV '{name}'" + (f" ({len(shown)} hidden lines shown)" if shown else "")
            + ("; voice learned" if learned else ""))
        return {"changed": changed, "labels": labels, "shown": shown, "learned": learned}

    @router.post("/api/days/{date}/voice-split")
    def voice_split(date: str, body: SplitBody):
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        seeds = {p.strip(): [{"start": float(l["start"]), "text": str(l["text"])} for l in ls]
                 for p, ls in body.seeds.items() if p.strip() and ls}
        if not seeds:
            raise HTTPException(400, "Tag a few lines for each person first")
        try:
            lines = split_voice(date, body.speaker, seeds)
        except FileNotFoundError as e:
            raise HTTPException(400, str(e))
        log(f"{date}: split '{body.speaker}' into {', '.join(seeds)}: {len(lines)} lines suggested")
        return {"lines": lines}

    @router.post("/api/days/{date}/voice-train")
    def voice_train(date: str, body: TrainBody):
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        lines = [{"start": float(l["start"]), "text": str(l["text"])} for l in body.lines if "start" in l and "text" in l]
        try:
            r = train_lines(date, body.person.strip(), lines, body.remove)
        except (ValueError, FileNotFoundError) as e:
            raise HTTPException(400, str(e))
        log(f"{date}: {body.person}'s voice {'un-taught' if body.remove else 'taught'} from "
            f"{len(lines if body.remove else r['trained'])} line(s)")
        return r

    @router.post("/api/days/{date}/voice-similar")
    def voice_similar(date: str, body: SimilarBody):
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        try:
            return {"lines": similar_lines(date, body.person.strip())}
        except FileNotFoundError as e:
            raise HTTPException(400, str(e))

    @router.post("/api/days/{date}/voice-noise")
    def voice_noise(date: str, body: VoiceNoiseBody):
        check_date(date)
        if not (transcript_path(date)).is_file():
            raise HTTPException(404, f"No transcript for {date}")
        lines = [{"start": float(l["start"]), "text": str(l["text"])} for l in body.lines] if body.lines is not None else None
        changed = mark_speaker_noise(date, body.speaker, body.noise, lines)
        log(f"{date}: '{body.speaker}' {'hidden as noise' if body.noise else 'shown again'} ({len(changed)} lines)")
        return {"changed": changed}

    @router.post("/api/days/{date}/voices/reviewed")
    def voices_reviewed(date: str, body: ReviewedBody):
        check_date(date)
        path = transcript_path(date)
        if not path.is_file():
            raise HTTPException(404, f"No transcript for {date}")
        with TRANSCRIPT_LOCK:
            data = json.loads(path.read_text(encoding="utf-8"))
            data["voices_reviewed"] = body.reviewed
            write_transcript(path, data)
        return {"reviewed": body.reviewed}

    return router
