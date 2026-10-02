"""Measuring a clip (speech level, noise floor, clipping, waveform) and suggesting automatic levels."""
import subprocess
from pathlib import Path

import numpy as np

from audio.levels import clip_chain, clip_levels, CLIPPED_PCT, NOISY_FLOOR_DB, QUIET_SPEECH_DB, save_levels, WAVE_BUCKETS
from audio.rustle import suppress_rustle
from core.config import INPUT_DIR, log, RUSTLE_MAXIMUM, SAMPLE_RATE
from core.settings import setting

def decode_mono(path: Path, start: float = 0.0, seconds: float | None = None, chain: str | None = None,
                post: str = "") -> np.ndarray:
    """Decode (part of) a recording to 16 kHz mono float, optionally through a filter chain."""
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}"]
    if seconds:
        cmd += ["-t", f"{seconds:.3f}"]
    cmd += ["-i", str(path)]
    af = ",".join(p for p in (chain or f"aresample={SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=mono", post) if p)
    cmd += ["-af", af, "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "f32le", "-"]
    out = subprocess.run(cmd, capture_output=True)
    if out.returncode != 0:
        raise RuntimeError(f"Couldn't read {path.name}: {out.stderr.decode(errors='ignore').strip()[:200]}")
    return np.frombuffer(out.stdout, np.float32)

_analysis_cache: dict[tuple, dict] = {}

def analyze_clip(path: Path, start: float = 0.0, seconds: float | None = None, name: str | None = None) -> dict:
    """Level statistics, problems and a waveform for a recording, or just the part of it from `start` for
    `seconds` (a segment). Cached per file version."""
    key = (str(path), path.stat().st_size, path.stat().st_mtime, start, seconds)
    if key in _analysis_cache:
        return _analysis_cache[key]
    db = lambda v: 20 * np.log10(np.maximum(v, 1e-9))
    x = decode_mono(path, start, seconds)
    # Clipping is judged on the original samples: runs of 3+ pinned near full scale
    cut = ["-ss", f"{start:.3f}"] + (["-t", f"{seconds:.3f}"] if seconds else [])
    raw = subprocess.run(["ffmpeg", "-v", "error", *cut, "-i", str(path), "-f", "f32le", "-"], capture_output=True).stdout
    r = np.abs(np.frombuffer(raw, np.float32)) >= 0.98
    clipped_pct = float((np.convolve(r.astype(np.int8), np.ones(3, np.int8), mode="same") >= 3).mean() * 100) if len(r) else 0.0
    del raw, r

    frame = SAMPLE_RATE // 20                                    # 50 ms
    n = len(x) // frame
    rms = db(np.sqrt((x[:n * frame].reshape(-1, frame) ** 2).mean(1))) if n else np.array([-90.0])
    speech, floor = (float(v) for v in np.percentile(rms, [95, 10]))
    peak = float(db(np.abs(x).max())) if len(x) else -90.0

    # Waveform: per bucket peak and RMS (linear, 0..1+)
    b = max(1, len(x) // WAVE_BUCKETS)
    nb = max(1, len(x) // b)
    xb = np.abs(x[:nb * b]).reshape(nb, b) if len(x) >= b else np.abs(x).reshape(1, -1)
    peaks = np.round(xb.max(1), 4).tolist()
    rmsb = np.round(np.sqrt((xb ** 2).mean(1)), 4).tolist()

    # How much of the recording is clothing rustle (Strong-level detection), in 10-minute pieces
    piece = SAMPLE_RATE * 600
    masks = [suppress_rustle(x[i:i + piece], SAMPLE_RATE, 0)[1] for i in range(0, len(x), piece)]
    rustle_pct = float(np.concatenate(masks).mean() * 100) if masks else 0.0

    issues = []
    if clipped_pct > CLIPPED_PCT:
        issues.append({"code": "clipping", "label": "Clipping",
                       "detail": f"{clipped_pct:.2f}% of the audio is cut off at full volume. Repair clipping can rebuild the peaks."})
    if speech < QUIET_SPEECH_DB:
        issues.append({"code": "quiet", "label": "Very quiet",
                       "detail": f"Speech peaks around {speech:.0f} dBFS (normal is about -15 to -22)."})
    if floor > NOISY_FLOOR_DB and speech - floor < 15:
        issues.append({"code": "noisy", "label": "Noisy",
                       "detail": f"Background noise sits at {floor:.0f} dBFS, close to the speech ({speech:.0f} dBFS)."})
    result = {"name": name or path.name, "duration": round(len(x) / SAMPLE_RATE, 2), "peak_db": round(peak, 1),
              "speech_db": round(speech, 1), "floor_db": round(floor, 1), "clipped_pct": round(clipped_pct, 3),
              "rustle_pct": round(rustle_pct, 1), "issues": issues, "peaks": peaks, "rms": rmsb}
    result["auto"] = auto_levels(result)
    _analysis_cache[key] = result
    return result

def auto_levels(a: dict) -> dict:
    """Best-guess levels from the measurements (no test transcription). Returns
    {"levels", "notes", "confident"}: confident = it should fix every problem the clip was flagged for."""
    speech, floor, peak, clipped = a["speech_db"], a["floor_db"], a["peak_db"], a["clipped_pct"]
    snr = speech - floor
    lv = {"gain_db": 0.0, "sensitivity": 3, "rustle": None, "gate_db": None, "declip": False}
    notes, problems = [], []
    if clipped > CLIPPED_PCT:
        lv["declip"] = True
        notes.append("repair clipping")
        if clipped > 1.0:
            problems.append("too heavily clipped to fully repair")
    # Volume: bring the loud parts of speech to about -18 dBFS, without pushing peaks past -1 dBFS.
    # Recordings already in the normal range (-24..-8) are left alone; normalisation evens those out.
    gain = 0.0 if -24 <= speech <= -8 else -18 - speech
    if gain > 0 and not lv["declip"]:
        gain = min(gain, -1 - peak)
    gain = round(max(-12, min(30, gain)))
    gain = 0 if abs(gain) < 3 else gain
    lv["gain_db"] = float(gain)
    if gain:
        notes.append(f"volume {gain:+d} dB")
    if speech + gain < QUIET_SPEECH_DB + 6:
        problems.append("can't be made loud enough without clipping")
    # Sensitivity: clean recordings can listen harder for quiet voices; noisy ones should listen less
    lv["sensitivity"] = 4 if snr >= 30 else 3 if snr >= 18 else 2
    if lv["sensitivity"] != 3:
        notes.append(f"sensitivity {'High' if lv['sensitivity'] == 4 else 'Low'}")
    # Noise gate just above the background, but only when the background is clearly audible
    if floor + gain > -45 and snr >= 10:
        lv["gate_db"] = float(round(max(-80, min(-20, floor + gain + 3))))
        notes.append(f"noise gate {lv['gate_db']:.0f} dB")
    if snr < 10:
        problems.append("speech is barely louder than the background")
    # Rustle: by how much of the recording is rustle
    lv["rustle"] = RUSTLE_MAXIMUM if a["rustle_pct"] >= 10 else 1.0 if a["rustle_pct"] >= 2 else 0.5
    notes.append(f"rustle {'Maximum' if lv['rustle'] >= RUSTLE_MAXIMUM else 'Strong' if lv['rustle'] >= 1 else 'Gentle'}"
                 f" ({a['rustle_pct']:.0f}% rustle)")
    return {"levels": lv, "notes": notes, "problems": problems, "confident": not problems}

def flagged_clips(segs: list[dict], autofix: bool = False) -> list[str]:
    """Segments with problems that the user hasn't looked at yet (returns their keys). With autofix, problems
    the auto-adjust rules can confidently fix are fixed (and saved) instead of being reported."""
    flagged = []
    for seg in segs:
        if clip_levels(seg["key"])["reviewed"]:
            continue
        a = analyze_segment(seg)
        if not a["issues"]:
            continue
        if autofix and a["auto"]["confident"]:
            save_levels({seg["key"]: {**a["auto"]["levels"], "auto": True}})
            log(f"      {seg['key']}: {', '.join(i['label'].lower() for i in a['issues'])} -> auto-adjusted "
                f"({', '.join(a['auto']['notes'])})")
            continue
        flagged.append(seg["key"])
    return flagged

def preview_wav(path: Path, start: float, lv: dict, seconds: float = 10.0) -> bytes:
    """A short WAV of the recording exactly as transcription will hear it."""
    import io
    from scipy.io import wavfile
    y = decode_mono(path, max(0.0, start), seconds, clip_chain(lv), "highpass=f=80,speechnorm=e=4:r=0.0001:l=1")
    strength = setting("rustle_strength") if lv.get("rustle") is None else lv["rustle"]
    if strength > 0 and len(y):
        y, _ = suppress_rustle(y, SAMPLE_RATE, strength)
    buf = io.BytesIO()
    wavfile.write(buf, SAMPLE_RATE, (np.clip(y, -1, 1) * 32767).astype(np.int16))
    return buf.getvalue()

def analyze_segment(seg: dict) -> dict:
    return analyze_clip(INPUT_DIR / seg["file"], seg["start"], seg["duration"], seg["key"])
