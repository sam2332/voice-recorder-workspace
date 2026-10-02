"""settings.json next to the voice DB: what the user chose in the viewer. Read with setting(key)."""
import os
import json
import threading
from pathlib import Path

from app_config import DB_PATH
from core.config import LANGUAGE, RUSTLE_MAXIMUM, RUSTLE_STRENGTH

SETTINGS_PATH = Path(os.getenv("SETTINGS_PATH", DB_PATH.parent / "settings.json"))

DEFAULT_SETTINGS = {
    "setup_done": False,          # nothing is transcribed automatically until the user has been through setup
    "auto_transcribe": False,     # transcribe new / incomplete days in the background
    "auto_sync": False,           # start syncing on startup if the recorder is connected
    "auto_summarize": False,      # summarize new days and update overview automatically
    "language": LANGUAGE or "en",   # "" = detect
    "rustle_strength": RUSTLE_STRENGTH,
}

_settings_lock = threading.Lock()

def load_settings() -> dict:
    data = dict(DEFAULT_SETTINGS)
    try:
        data.update(json.loads(SETTINGS_PATH.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        pass
    return data

def save_settings(patch: dict) -> dict:
    allowed = {"setup_done": bool, "auto_transcribe": bool, "auto_sync": bool, "auto_summarize": bool, "language": str, "rustle_strength": float}
    with _settings_lock:
        data = load_settings()
        for key, kind in allowed.items():
            if key in patch and patch[key] is not None:
                data[key] = kind(patch[key])
        data["language"] = data["language"].strip().lower()[:8]
        data["rustle_strength"] = min(max(data["rustle_strength"], 0.0), RUSTLE_MAXIMUM)
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = SETTINGS_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(SETTINGS_PATH)
    return data

def setting(key: str):
    return load_settings()[key]
