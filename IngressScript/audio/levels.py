"""Per-recording levels (gain, sensitivity, rustle, gate, declip) in clip_levels.json, and the ffmpeg chain they build."""
import json
import threading
from pathlib import Path

from core.config import FILE_PATTERN, OUTPUT_DIR, RUSTLE_MAXIMUM, SAMPLE_RATE, SEGMENT_KEY_RE, VAD_OFFSET, VAD_ONSET

# Speech sensitivity 1..5 -> Whisper voice-activity onset/offset. 3 is the normal setting.
SENSITIVITY = {1: (0.60, 0.45), 2: (0.48, 0.35), 3: (VAD_ONSET, VAD_OFFSET), 4: (0.25, 0.18), 5: (0.15, 0.10)}

QUIET_SPEECH_DB = -32      # loud parts of a clip below this = "very quiet" (normal recordings sit at -14..-22)

NOISY_FLOOR_DB = -38       # background above this, with little gap to the speech = "noisy"

CLIPPED_PCT = 0.05         # % of samples pinned at full scale = "clipping"

WAVE_BUCKETS = 1000        # waveform resolution sent to the viewer

_levels_lock = threading.Lock()

def levels_path() -> Path:
    return OUTPUT_DIR / "clip_levels.json"

def load_levels() -> dict[str, dict]:
    try:
        return json.loads(levels_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

def clip_levels(name: str) -> dict:
    """Levels for one recording: saved ones, else defaults (rustle None = the global setting)."""
    lv = {"gain_db": 0.0, "sensitivity": 3, "rustle": None, "gate_db": None, "declip": False, "reviewed": False,
          "auto": False}
    lv.update(load_levels().get(name, {}))
    return lv

def save_levels(updates: dict[str, dict], reviewed: bool = True) -> dict[str, dict]:
    with _levels_lock:
        data = load_levels()
        for name, lv in updates.items():
            if not (FILE_PATTERN.match(name) or SEGMENT_KEY_RE.match(name)):
                continue
            cur = clip_levels(name)
            rustle = lv.get("rustle", cur["rustle"])
            gate = lv.get("gate_db", cur["gate_db"])
            cur.update({
                "gain_db": float(min(max(float(lv.get("gain_db", cur["gain_db"])), -24), 36)),
                "sensitivity": int(min(max(int(lv.get("sensitivity", cur["sensitivity"])), 1), 5)),
                "rustle": None if rustle is None else float(min(max(float(rustle), 0), RUSTLE_MAXIMUM)),
                "gate_db": None if gate is None else float(min(max(float(gate), -80), -15)),
                "declip": bool(lv.get("declip", cur["declip"])),
                "reviewed": reviewed or cur["reviewed"],
                "auto": bool(lv.get("auto", False)),   # set by auto-adjust; cleared when the user edits
            })
            data[name] = cur
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        tmp = levels_path().with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(levels_path())
        return data

def clip_chain(lv: dict) -> str:
    """ffmpeg filters applied to one recording before the day is joined together."""
    parts = []
    if lv.get("declip"):
        parts.append("adeclip")                          # rebuild clipped peaks (at the original rate)
    parts += [f"aresample={SAMPLE_RATE}", "aformat=sample_fmts=fltp:channel_layouts=mono"]
    if lv.get("gain_db"):
        parts += [f"volume={lv['gain_db']:.1f}dB", "asoftclip=type=hard:threshold=1"]  # too much gain really clips
    if lv.get("gate_db") is not None:
        parts.append(f"agate=threshold={10 ** (lv['gate_db'] / 20):.6f}:range=0.01:attack=5:release=200")
    return ",".join(parts)
