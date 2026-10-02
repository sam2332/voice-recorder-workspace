"""Injected state for the voice_memory package.

`app.py` calls `configure()` once with the paths, helpers and lock it owns, so no
module in this package has to import `app.py` (which would be circular). Every
module reads these accessors instead of reaching for app globals directly.
"""

_state = {
    "db_path": None,
    "day_dir": None,
    "transcript_path": None,
    "all_transcripts": None,
    "load_transcript": None,
    "write_transcript": None,
    "lock": None,
    "log": print,
    "hf_token": None,
}


def configure(*, db_path, day_dir, transcript_path, all_transcripts,
              load_transcript, write_transcript, lock, log=print, hf_token=None):
    _state.update(db_path=db_path, day_dir=day_dir, transcript_path=transcript_path,
                  all_transcripts=all_transcripts, load_transcript=load_transcript,
                  write_transcript=write_transcript, lock=lock, log=log, hf_token=hf_token)


def db_path():
    from app_config import DB_PATH
    return _state["db_path"] or DB_PATH


def day_dir():
    return _state["day_dir"]


def transcript_path():
    return _state["transcript_path"]


def all_transcripts():
    return _state["all_transcripts"]


def load_transcript():
    return _state["load_transcript"]


def write_transcript():
    return _state["write_transcript"]


def lock():
    return _state["lock"]


def log():
    return _state["log"]


def hf_token():
    return _state["hf_token"] if _state["hf_token"] is not None else None
