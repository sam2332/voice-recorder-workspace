"""Deciding whether a transcribed line is noise (rustle, hallucinated phrases)."""
import re

from core.config import HALLUCINATIONS, NOISE_IF_RUSTLE, NOISE_PHRASES

def looks_like_noise(text: str, rustle: float, score: float | None) -> bool:
    """A transcript line that is most likely Whisper 'hearing' words in rustle or other noise."""
    if any(h in text.lower() for h in HALLUCINATIONS):
        return True
    words = re.sub(r"[^\w\s']", " ", text.lower()).split()
    phrase = " ".join(dict.fromkeys(words))  # "so so" -> "so"
    weak = score is not None and score < 0.5
    if phrase in NOISE_PHRASES and (rustle >= 0.4 or weak):
        return True
    if phrase in NOISE_IF_RUSTLE and rustle >= 0.6:
        return True
    return rustle >= 0.8 and len(words) <= 4 and (score is None or score < 0.6)
