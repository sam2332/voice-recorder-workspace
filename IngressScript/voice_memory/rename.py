"""Renaming / merging speakers across the voice DB and every transcript."""
import json

from storage import init_db
from . import _state


class RenameError(ValueError):
    pass


class NameTaken(RenameError):
    """The new name belongs to someone else; pass merge=True to make them one person."""


def rename_speaker_core(old: str, new: str, merge: bool = False) -> int:
    """Rename a speaker in the voice DB and every transcript. If `new` is an existing person and
    `merge` is set, the two become one: voiceprints are pooled and every line moves to `new`.
    Returns the number of transcripts changed."""
    new = new.strip()
    if not new:
        raise RenameError("The new name can't be empty.")
    if new == old:
        return 0
    load = _state.load_transcript()
    all_transcripts = _state.all_transcripts()
    conn = init_db()
    old_row = conn.execute("SELECT id FROM speakers WHERE name = ?", (old,)).fetchone()
    new_row = conn.execute("SELECT id FROM speakers WHERE name = ?", (new,)).fetchone()
    in_transcripts = {p: load(p) for _, p in all_transcripts()}
    target_in_use = new_row or any(s.get("speaker") == new for d in in_transcripts.values() for s in d.get("segments", []))
    if target_in_use and not merge:
        raise NameTaken(f"'{new}' is already someone else. Merge '{old}' into '{new}'?")

    if old_row and new_row:
        conn.execute("UPDATE voiceprints SET speaker_id = ? WHERE speaker_id = ?", (new_row[0], old_row[0]))
        conn.execute("DELETE FROM speakers WHERE id = ?", (old_row[0],))
        conn.execute("UPDATE speakers SET sample_count = (SELECT COUNT(*) FROM voiceprints WHERE speaker_id = ?) "
                     "WHERE id = ?", (new_row[0], new_row[0]))
    elif old_row:
        conn.execute("UPDATE speakers SET name = ? WHERE id = ?", (new, old_row[0]))

    # Update existing transcripts too, so old days show the new name (trashed lines included)
    pending = [p for p, d in in_transcripts.items()
               if any(s.get("speaker") == old or old in (s.get("overlap") or [])
                      for s in d.get("segments", []) + d.get("trashed", []))
               or any(v.get("name") == old for v in d.get("voices", []))]
    if not old_row and not pending:
        conn.rollback()
        raise RenameError(f"No speaker named '{old}'. Run with --speakers to see the list.")
    conn.commit()
    lock = _state.lock()
    with lock:
        for path in pending:
            data = json.loads(path.read_text(encoding="utf-8"))   # fresh copy, not the cache
            for seg in data.get("segments", []) + data.get("trashed", []):
                if seg.get("speaker") == old:
                    seg["speaker"] = new
            rename_in_overlaps(data, old, new)
            for v in data.get("voices", []):
                if v.get("name") == old:
                    v["name"] = new
            _state.write_transcript()(path, data)
    return len(pending)


def rename_in_overlaps(data: dict, old: str, new: str):
    """Older transcripts only stored names in "overlap"; keep those in step with renames."""
    for seg in data.get("segments", []) + data.get("trashed", []):
        if seg.get("overlap") and old in seg["overlap"]:
            seg["overlap"] = sorted({new if n == old else n for n in seg["overlap"]})
