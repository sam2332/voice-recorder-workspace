"""Line edits on one day's transcript: trash/restore/replace, relabel, hide a voice as noise."""
import json

from core.paths import transcript_path
from transcripts.store import TRANSCRIPT_LOCK, write_transcript
from voice_memory import rename_in_overlaps

def overlaps_trashed(seg: dict, trashed: list[dict]) -> bool:
    """True if a new line mostly covers the same moment as a line the user trashed."""
    d = max(seg["end"] - seg["start"], 0.01)
    return any(min(seg["end"], t["end"]) - max(seg["start"], t["start"]) >= 0.5 * d for t in trashed)

def edit_lines(date: str, items: list[dict], action: str, new: list[dict] | None = None) -> int:
    """Viewer edits on a day's transcript. Lines are identified by start time + text.
    action: 'trash' (remove; remembered so re-transcribing won't bring them back),
            'restore' (undo a trash), 'keep' (it was flagged as noise but is real speech), or
            'replace' (swap `items` for the lines in `new`: edits, speaker changes, split, join, undo)."""
    path = transcript_path(date)
    same = lambda a, b: abs(a["start"] - b["start"]) < 0.02 and a["text"] == b["text"]
    with TRANSCRIPT_LOCK:
        data = json.loads(path.read_text(encoding="utf-8"))
        data.setdefault("trashed", [])
        changed = 0
        if action == "trash":
            keep = []
            for seg in data["segments"]:
                if any(same(seg, it) for it in items):
                    data["trashed"].append(seg)
                    changed += 1
                else:
                    keep.append(seg)
            data["segments"] = keep
        elif action == "restore":
            back = [t for t in data["trashed"] if any(same(t, it) for it in items)]
            data["trashed"] = [t for t in data["trashed"] if t not in back]
            for seg in back:
                seg.pop("noise", None)   # restoring a line says "this is real"
            data["segments"] = sorted(data["segments"] + back, key=lambda s: s["start"])
            changed = len(back)
        elif action == "keep":
            for seg in data["segments"]:
                if seg.get("noise") and any(same(seg, it) for it in items):
                    del seg["noise"]
                    changed += 1
        elif action == "replace":
            gone = [seg for seg in data["segments"] if any(same(seg, it) for it in items)]
            if len(gone) != len(items):
                raise ValueError("That line changed since the page loaded. Reload and try again.")
            data["segments"] = sorted([seg for seg in data["segments"] if seg not in gone] + (new or []),
                                      key=lambda s: s["start"])
            changed = len(gone) + len(new or [])
        if changed:
            write_transcript(path, data)
        return changed

def resolve_overlap_names(data: dict) -> dict:
    """Fill each line's "overlap" with the CURRENT names of the voices that talked over it
    (labels -> names via the day's voices list), dropping the line's own speaker."""
    label_name = {v["label"]: v["name"] for v in data.get("voices", []) if v.get("label")}
    for seg in data.get("segments", []):
        if seg.get("overlap_labels"):
            names = {label_name.get(l, "Unknown") for l in seg["overlap_labels"]}
            names.discard(seg.get("speaker"))
            if names:
                seg["overlap"] = sorted(names)
            else:
                seg.pop("overlap", None)
        elif seg.get("overlap"):
            seg["overlap"] = [n for n in seg["overlap"] if n != seg.get("speaker")]
            if not seg["overlap"]:
                seg.pop("overlap")
    return data

def relabel_speaker(date: str, old: str, new: str, lines: list[dict] | None = None) -> list[dict]:
    """Say who a voice is on ONE day: every line (or just `lines`) by `old` becomes `new`.
    Other days and the voice database are untouched. Returns the lines changed (for undo)."""
    path = transcript_path(date)
    same = lambda a, b: abs(a["start"] - b["start"]) < 0.02 and a["text"] == b["text"]
    with TRANSCRIPT_LOCK:
        data = json.loads(path.read_text(encoding="utf-8"))
        changed = []
        for seg in data.get("segments", []) + data.get("trashed", []):
            if seg.get("speaker") == old and (lines is None or any(same(seg, l) for l in lines)):
                seg["speaker"] = new
                changed.append({"start": seg["start"], "text": seg["text"]})
        if changed and lines is None:
            rename_in_overlaps(data, old, new)   # whole voice renamed: its "talking over" tags follow
        if changed:
            write_transcript(path, data)
        return changed

def mark_speaker_noise(date: str, speaker: str, noise: bool, lines: list[dict] | None = None) -> list[dict]:
    """Flag every line of one voice on ONE day as noise (a TV show, music...) or clear it again.
    Returns the lines changed, so undo can pass them back as `lines`."""
    path = transcript_path(date)
    same = lambda a, b: abs(a["start"] - b["start"]) < 0.02 and a["text"] == b["text"]
    with TRANSCRIPT_LOCK:
        data = json.loads(path.read_text(encoding="utf-8"))
        changed = []
        for seg in data.get("segments", []):
            if seg.get("speaker") != speaker or bool(seg.get("noise")) == noise:
                continue
            if lines is not None and not any(same(seg, l) for l in lines):
                continue
            if noise:
                seg["noise"] = True
            else:
                del seg["noise"]
            changed.append({"start": seg["start"], "text": seg["text"]})
        if changed:
            write_transcript(path, data)
        return changed
