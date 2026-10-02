"""Merge one day's recordings into <date>/merged.wav (ffmpeg concat filter + per-clip levels)."""
import json
import subprocess
from pathlib import Path

import numpy as np

from audio.files import probe_duration
from audio.levels import clip_chain, clip_levels
from audio.rustle import derustle_wav
from audio.segments import day_segments, segment_dir
from core.config import log, RUSTLE_HOP, SAMPLE_RATE
from core.paths import day_dir, rustle_mask_path
from core.settings import setting

def prepare_daily_audio(date_str: str, file_list: list[Path]) -> tuple[Path, list[dict]]:
    """Cut the day's speech segments out of the recordings, each through its own levels (gain / gate / clipping
    repair), clean up clothing rustle, and join them into <date>/merged.wav. Every segment is also kept as its
    own file in <date>/segments/. Returns the merged file and the segments as sources (where each one sits in it)."""
    from scipy.io import wavfile
    import wave
    day = day_dir(date_str)
    seg_dir = segment_dir(date_str)
    seg_dir.mkdir(parents=True, exist_ok=True)
    merged_path, manifest, mask_path = day / "merged.wav", day / "merged.sources.json", rustle_mask_path(date_str)
    segs = day_segments(date_str, file_list)
    if not segs:
        raise RuntimeError("No speech was found in this day's recordings.")
    strength = setting("rustle_strength")
    by_name = {f.name: f for f in file_list}
    levels = {g["key"]: {k: v for k, v in clip_levels(g["key"]).items() if k not in ("reviewed", "auto")} for g in segs}
    sigs = {g["key"]: {"size": by_name[g["file"]].stat().st_size, "start": g["start"], "duration": g["duration"],
                       "rustle": strength, "levels": levels[g["key"]]} for g in segs}
    # Rebuilt only when the recordings, a segment's levels, or the rustle setting change
    if merged_path.exists() and manifest.exists() and mask_path.exists():
        try:
            saved = json.loads(manifest.read_text(encoding="utf-8"))
            if saved.get("sig") == sigs:
                return merged_path, saved["sources"]
        except (OSError, json.JSONDecodeError, KeyError):
            pass

    masks = []
    for g in segs:
        key, wav, npy, sig_file = g["key"], seg_dir / f"{g['key']}.wav", seg_dir / f"{g['key']}.npy", seg_dir / f"{g['key']}.json"
        try:
            fresh = wav.exists() and npy.exists() and json.loads(sig_file.read_text(encoding="utf-8")) == sigs[key]
        except (OSError, json.JSONDecodeError):
            fresh = False
        if not fresh:
            lv = levels[key]
            tmp = wav.with_suffix(".tmp.wav")
            cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{g['start']}", "-t", f"{g['duration']}",
                   "-i", str(by_name[g["file"]]), "-af", clip_chain(lv) + ",highpass=f=80,speechnorm=e=4:r=0.0001:l=1",
                   "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", str(tmp)]
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    raise RuntimeError(f"ffmpeg failed cutting {key}:\n{proc.stderr.strip()[-200:]}")
                with wave.open(str(tmp)) as w:
                    n = w.getnframes()
                mask = derustle_wav(tmp, [(0, n, strength if lv["rustle"] is None else lv["rustle"])])
                np.save(npy, mask)
                tmp.replace(wav)
                sig_file.write_text(json.dumps(sigs[key]), encoding="utf-8")
            finally:
                tmp.unlink(missing_ok=True)
    for stale in seg_dir.iterdir():
        if stale.stem not in sigs and stale.stem.removesuffix(".tmp") not in sigs:
            stale.unlink(missing_ok=True)

    # Join the segments; each is padded to a whole number of rustle-map steps so the map lines up
    tmp_merged = merged_path.with_suffix(".tmp.wav")
    sources, offset = [], 0
    try:
        with wave.open(str(tmp_merged), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            for g in segs:
                _, data = wavfile.read(seg_dir / f"{g['key']}.wav")
                pad = (-len(data)) % RUSTLE_HOP
                w.writeframes(data.astype(np.int16).tobytes() + bytes(2 * pad))
                masks.append(np.load(seg_dir / f"{g['key']}.npy"))
                sources.append({"name": g["key"], "file": g["file"], "file_start": g["start"],
                                "start": round(offset / SAMPLE_RATE, 3), "duration": round((len(data) + pad) / SAMPLE_RATE, 3),
                                "recorded_at": g["recorded_at"], "bytes": sigs[g["key"]]["size"]})
                offset += len(data) + pad
        mask = np.concatenate(masks)
        np.save(mask_path, mask)
        tmp_merged.replace(merged_path)
    finally:
        tmp_merged.unlink(missing_ok=True)
    manifest.write_text(json.dumps({"sig": sigs, "sources": sources}), encoding="utf-8")
    total = sum(probe_duration(f) for f in file_list)
    log(f"      {len(segs)} speech segment(s): {offset / SAMPLE_RATE / 60:.0f} of {total / 60:.0f} min kept; "
        f"rustle suppressed in {mask.mean() * 100:.0f}% of it")
    return merged_path, sources
