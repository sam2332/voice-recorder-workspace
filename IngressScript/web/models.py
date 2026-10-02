"""Request bodies for the viewer API."""
from pydantic import BaseModel


class RenameBody(BaseModel):
    old: str
    new: str
    merge: bool = False


class ProcessBody(BaseModel):
    # None = reuse the day's previous hint; {} = let it decide automatically
    hint: dict | None = None


class LinesBody(BaseModel):
    action: str               # trash | restore | keep | replace
    items: list[dict]         # [{start, text}]
    new: list[dict] | None = None   # replace: the lines that take their place


class ClipBody(BaseModel):
    start: float
    end: float
    text: str = ""


class SettingsBody(BaseModel):
    setup_done: bool | None = None
    auto_transcribe: bool | None = None
    auto_sync: bool | None = None
    language: str | None = None
    rustle_strength: float | None = None


class SyncBody(BaseModel):
    root: str


class LevelsBody(BaseModel):
    levels: dict[str, dict]       # recording name -> {gain_db, sensitivity, rustle, gate_db, declip}
    reviewed: bool = True


class BlockedBody(BaseModel):
    action: str                   # continue | skip


class ExtractBody(BaseModel):
    retry: bool = False


class RelabelBody(BaseModel):
    old: str
    new: str
    lines: list[dict] | None = None   # only these lines (used by undo); default = all of `old`'s lines
    labels: list[str] | None = None   # which voices to move back (used by undo)


class TvVoiceBody(BaseModel):
    speaker: str
    name: str   # the channel / show, e.g. "MKBHD"


class SplitBody(BaseModel):
    speaker: str
    seeds: dict[str, list[dict]]   # person -> [{start, text}] lines the user tagged


class TrainBody(BaseModel):
    person: str
    lines: list[dict]          # [{start, text}]
    remove: bool = False       # undo: forget these lines again


class SimilarBody(BaseModel):
    person: str


class VoiceNoiseBody(BaseModel):
    speaker: str
    noise: bool = True
    lines: list[dict] | None = None   # only these lines (used by undo)


class ReviewedBody(BaseModel):
    reviewed: bool = True


class ProfileBody(BaseModel):
    name: str
    tv: bool | None = None


class MeetingBody(BaseModel):
    name: str = ""
    items: list[dict] = []


class MeetingItemsBody(BaseModel):
    add: list[dict] = []
    remove: list[dict] = []
