"""A day split wherever real speech stops for a long time."""
import json
from pathlib import Path

import numpy as np

from audio.analysis import decode_mono
from audio.files import recorded_at
from core.config import INPUT_DIR, RECORDING_SUFFIXES, SAMPLE_RATE, SEGMENT_DENSITY, SEGMENT_GAP_SECONDS, SEGMENT_KEY_RE, SEGMENT_MIN_FRAMES, SEGMENT_MIN_SPEECH_SECONDS, SEGMENT_PAD_SECONDS, SEGMENT_SPEECH_DB
from core.paths import day_dir

def speech_spans(x: np.ndarray) -> list[tuple[float, float]]:
    """(start, end) seconds of the stretches of one recording that contain speech. Steady noise (a fan)
    can't count as speech: a frame is speech only when its voice band rises well above the local noise
    floor (the quietest fifth of the surrounding minute) and isn't clothing rustle. Stretches closer than
    SEGMENT_GAP_SECONDS are joined; ones with almost no speech are dropped."""
    from scipy.ndimage import percentile_filter
    frame = SAMPLE_RATE // 50                                    # 20 ms
    nf = len(x) // frame // 5 * 5
    if nf < 5:
        return []
    freqs = np.fft.rfftfreq(frame, 1 / SAMPLE_RATE)
    voice, high = (freqs >= 100) & (freqs < 1000), freqs >= 2500
    win = np.hanning(frame).astype(np.float32)
    v, h = np.empty(nf, np.float32), np.empty(nf, np.float32)
    for a in range(0, nf, 20000):
        b = min(nf, a + 20000)
        p = np.abs(np.fft.rfft(x[a * frame:b * frame].reshape(-1, frame) * win, axis=1)) ** 2
        v[a:b], h[a:b] = p[:, voice].sum(1), p[:, high].sum(1)
    v, h = v.reshape(-1, 5).mean(1), h.reshape(-1, 5).mean(1)    # 100 ms
    vdb = 10 * np.log10(v + 1e-9)
    floor = percentile_filter(vdb, 20, size=600, mode="nearest")
    speechy = (vdb > floor + SEGMENT_SPEECH_DB) & (h < 1.5 * v)
    sec = speechy[:len(speechy) // 10 * 10].reshape(-1, 10).sum(1) >= SEGMENT_MIN_FRAMES   # a second with enough speechy tenths
    # Speech comes in runs; scattered single seconds (a clatter, a door) don't count
    sec &= np.convolve(sec.astype(np.int8), np.ones(11, np.int8), mode="same") >= SEGMENT_DENSITY
    spans, start, last = [], None, None
    for i in np.flatnonzero(sec):
        if start is not None and i - last >= SEGMENT_GAP_SECONDS:
            spans.append((start, last + 1))
            start = None
        if start is None:
            start = i
        last = i
    if start is not None:
        spans.append((start, last + 1))
    total = len(x) / SAMPLE_RATE
    return [(float(max(0.0, a - SEGMENT_PAD_SECONDS)), float(min(total, b + SEGMENT_PAD_SECONDS)))
            for a, b in spans if sec[a:b].sum() >= SEGMENT_MIN_SPEECH_SECONDS]

def segments_path(date: str) -> Path:
    return day_dir(date) / "segments.json"

def day_segments(date: str, files: list[Path]) -> list[dict]:
    """The day's speech segments, one per stretch of speech inside a recording (never across two recordings).
    A segment is identified by its key '<recording name>@<start second>', which is also where its levels are saved.
    Found once per set of recordings and remembered in <date>/segments.json."""
    params = [SEGMENT_GAP_SECONDS, SEGMENT_PAD_SECONDS, SEGMENT_MIN_SPEECH_SECONDS, SEGMENT_SPEECH_DB, SEGMENT_MIN_FRAMES, SEGMENT_DENSITY]
    sig = {"files": [[f.name, f.stat().st_size] for f in files], "params": params}
    try:
        saved = json.loads(segments_path(date).read_text(encoding="utf-8"))
        if saved.get("sig") == sig:
            return saved["segments"]
    except (OSError, json.JSONDecodeError, KeyError):
        pass
    segs = []
    for f in files:
        x = decode_mono(f)
        total = len(x) / SAMPLE_RATE
        h, m, s = (int(v) for v in (recorded_at(f.name) or "00:00:00").split(":"))
        spans = speech_spans(x)
        if not spans and total < 120:
            spans = [(0.0, total)]   # a short clip: let transcription decide rather than risk losing a few words
        for a, b in spans:
            a, b = int(a), min(int(np.ceil(b)), int(total))   # whole seconds: the start is part of the key
            if b - a < 1:
                continue
            t = (h * 3600 + m * 60 + s + a) % 86400
            segs.append({"key": f"{f.stem}@{a:05d}", "file": f.name, "start": a, "end": b, "duration": b - a,
                         "recorded_at": f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"})
        del x
    day_dir(date).mkdir(parents=True, exist_ok=True)
    segments_path(date).write_text(json.dumps({"sig": sig, "segments": segs}, indent=1), encoding="utf-8")
    return segs

def segment_source(key: str) -> tuple[Path, int] | None:
    """The recording a segment key points into, and where the segment starts in it."""
    m = SEGMENT_KEY_RE.match(key)
    if not m:
        return None
    path = next((f for f in INPUT_DIR.iterdir() if f.is_file() and f.stem == m.group(1) and f.suffix.lower() in RECORDING_SUFFIXES), None) \
        if INPUT_DIR.is_dir() else None
    return (path, int(m.group(2))) if path else None

def segment_dir(date: str) -> Path:
    return day_dir(date) / "segments"

def day_parts(data: dict, gap: float = SEGMENT_GAP_SECONDS) -> list[dict]:
    """The day's segments with their lines and speakers. New transcripts are built from segments, so those
    are used as they are; older ones (one source per recording) are split wherever real speech stops for
    `gap` seconds, so a fan or rustle that keeps the recorder running doesn't hold two meetings together."""
    lines = sorted((s for s in data.get("segments", []) if not s.get("noise")), key=lambda s: s["start"])
    own = [s for s in data.get("sources", []) if isinstance(s, dict) and "file" in s]
    parts, talk = [], []
    if own:
        for src in own:
            end = src["start"] + src["duration"]
            parts.append({"start": src["start"], "end": end, "lines": 0})
            talk.append({})
            for s in lines:
                if src["start"] - 0.01 <= s["start"] < end:
                    parts[-1]["lines"] += 1
                    talk[-1][s.get("speaker", "Unknown")] = talk[-1].get(s.get("speaker", "Unknown"), 0.0) + s["end"] - s["start"]
    else:
        for s in lines:
            who = s.get("speaker", "Unknown")
            if parts and s["start"] - parts[-1]["end"] < gap:
                p = parts[-1]
                p["end"] = max(p["end"], s["end"])
                p["lines"] += 1
            else:
                parts.append({"start": s["start"], "end": s["end"], "lines": 1})
                talk.append({})
            talk[-1][who] = talk[-1].get(who, 0.0) + s["end"] - s["start"]
    for p, t in zip(parts, talk):
        p["speakers"] = sorted(t, key=t.get, reverse=True)
    return parts
