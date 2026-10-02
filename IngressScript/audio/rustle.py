"""Clothing-rustle suppression on the merged WAV, and the rustle mask helpers."""
from pathlib import Path

import numpy as np

from core.config import RUSTLE_DUCK, RUSTLE_HOP, RUSTLE_MAX_CUT_DB, RUSTLE_MAX_CUT_DB_MAXIMUM, RUSTLE_MAXIMUM, RUSTLE_MIN_DB, RUSTLE_STRENGTH, SAMPLE_RATE

def suppress_rustle(x: np.ndarray, sr: int = SAMPLE_RATE, strength: float = RUSTLE_STRENGTH):
    """Turn down fabric rustle (a mic rubbing on a shirt) in float audio. Rustle is loud hiss whose
    energy sits mostly above ~2.5 kHz, while voices keep most of theirs below 1 kHz. Where the high
    band swamps the voice band for longer than a syllable (so 's' sounds are left alone), the high
    band is pulled down to a speech-like level and 1-2.5 kHz gets half that cut. The voice band is
    never touched, so speech under the rustle survives.
    strength >= RUSTLE_MAXIMUM ("Maximum") also catches lighter rustle, cuts harder (both upper bands,
    up to RUSTLE_MAX_CUT_DB_MAXIMUM) and turns the whole sound down during rustle with no speech in it,
    at the risk of swallowing a quiet word said while rustling.
    Returns (cleaned audio, rustle mask with one bool per RUSTLE_HOP samples)."""
    n, hop = 2 * RUSTLE_HOP, RUSTLE_HOP
    n_hops = (len(x) + hop - 1) // hop
    if len(x) < 4 * n:
        return x, np.zeros(n_hops, bool)
    win = np.sqrt(np.hanning(n + 1)[:-1]).astype(np.float32)   # sqrt-Hann at 50% overlap reconstructs exactly
    freqs = np.fft.rfftfreq(n, 1 / sr)
    voice_b = (freqs >= 100) & (freqs < 1000)
    mid_b = (freqs >= 1000) & (freqs < 2500)
    high_b = freqs >= 2500
    maximum = strength >= RUSTLE_MAXIMUM
    floor = 10 ** (-(RUSTLE_MAX_CUT_DB_MAXIMUM if maximum else RUSTLE_MAX_CUT_DB) / 20)

    pad = np.concatenate([np.zeros(n, np.float32), x.astype(np.float32), np.zeros(n + hop, np.float32)])
    total = (len(pad) - n) // hop + 1
    frames = np.lib.stride_tricks.sliding_window_view(pad, n)[::hop][:total] * win
    X = np.fft.rfft(frames, axis=1)
    P = (X.real ** 2 + X.imag ** 2) + 1e-12
    v = P[:, voice_b].sum(1)
    h = P[:, high_b].sum(1)
    rustle = (h > (1.0 if maximum else 1.5) * v) & (10 * np.log10(P.sum(1)) > RUSTLE_MIN_DB)
    # Must persist ~240 ms: 's'/'sh' sounds are shorter than that, rustle bursts are longer
    rustle = np.convolve(rustle.astype(np.float32), np.ones(15) / 15, mode="same") > 0.5
    if strength > 0:
        target = 0.1 if maximum else 0.3                 # high band vs voice band that speech normally has
        g_high = np.where(rustle, np.clip(np.sqrt(target * v / h), floor, 1.0), 1.0) ** min(strength, 1.0)
        g_high = np.convolve(g_high, np.ones(5) / 5, mode="same").astype(np.float32)  # no pumping/clicks
        X[:, high_b] *= g_high[:, None]
        X[:, mid_b] *= (g_high if maximum else np.sqrt(g_high))[:, None]
        if maximum:
            # Rustle with no voice under it: turn everything down, voice band included
            voiceless = rustle & (v < 0.25 * h)
            g_all = np.convolve(np.where(voiceless, RUSTLE_DUCK, 1.0), np.ones(5) / 5, mode="same").astype(np.float32)
            X *= g_all[:, None]
    y = np.fft.irfft(X, n=n, axis=1).astype(np.float32) * win
    out = np.zeros(len(pad), np.float32)          # overlap-add; hop is exactly half a frame
    out[:total * hop] += y[:, :hop].reshape(-1)
    out[hop:(total + 1) * hop] += y[:, hop:].reshape(-1)
    # Frame k is centred on sample (k - 1) * hop of x
    mask = rustle[1:n_hops + 1]
    return out[n:n + len(x)], np.pad(mask, (0, max(0, n_hops - len(mask))))

def derustle_wav(path: Path, regions: list[tuple[int, int, float]]) -> np.ndarray:
    """Clean a 16 kHz mono WAV in place. `regions` gives (start sample, end sample, strength) per
    recording, so each clip can have its own rustle setting. Works in ~10-minute pieces so multi-hour
    days stay light on memory. Returns the rustle mask for the whole file."""
    from scipy.io import wavfile
    sr, data = wavfile.read(path, mmap=True)
    piece, ctx = RUSTLE_HOP * 37500, RUSTLE_HOP * 64   # ~10 min pieces, ~1 s of context each side
    out = np.empty(len(data), np.int16)
    mask = np.zeros((len(data) + RUSTLE_HOP - 1) // RUSTLE_HOP, bool)
    # Contiguous, hop-aligned regions that cover every sample (clip lengths are rounded)
    regions = sorted(regions) or [(0, len(data), RUSTLE_STRENGTH)]
    starts = [0] + [r[0] // RUSTLE_HOP * RUSTLE_HOP for r in regions[1:]]
    bounds = [(starts[i], starts[i + 1] if i + 1 < len(starts) else len(data), regions[i][2])
              for i in range(len(regions))]
    for r0, r1, strength in bounds:
        for a in range(r0, r1, piece):
            lo, hi = max(0, a - ctx), min(len(data), a + piece + ctx)
            y, m = suppress_rustle(data[lo:hi].astype(np.float32) / 32768, sr, strength)
            b = min(a + piece, r1)
            out[a:b] = np.clip(y[a - lo:b - lo] * 32768, -32768, 32767).astype(np.int16)
            ma, mb = a // RUSTLE_HOP, (b + RUSTLE_HOP - 1) // RUSTLE_HOP
            mask[ma:mb] = m[(a - lo) // RUSTLE_HOP:(a - lo) // RUSTLE_HOP + (mb - ma)]
    del data
    tmp = path.with_suffix(".clean.wav")
    wavfile.write(tmp, sr, out)
    tmp.replace(path)
    return mask

def rustle_share(mask: np.ndarray | None, start: float, end: float) -> float:
    """Fraction of a stretch of the merged day audio that was rustle."""
    if mask is None or not len(mask):
        return 0.0
    a, b = int(start * SAMPLE_RATE / RUSTLE_HOP), int(np.ceil(end * SAMPLE_RATE / RUSTLE_HOP))
    seg = mask[a:max(b, a + 1)]
    return float(seg.mean()) if len(seg) else 0.0
