"""Engine: loads WhisperX + pyannote once and runs process_day. Heavy imports stay lazy."""
import warnings
import json
from pathlib import Path

import numpy as np

from app_config import HF_TOKEN
from audio.levels import clip_levels, SENSITIVITY
from audio.merge import prepare_daily_audio
from audio.rustle import rustle_share
from core.config import log, MIN_SPEECH_UNDER_LINE, OVERLAP_MIN_SECONDS, OVERLAP_MIN_SHARE, SAME_PERSON_THRESHOLD, SAMPLE_RATE, STEPS, VAD_OFFSET, VAD_ONSET
from core.paths import rustle_mask_path, transcript_path
from core.settings import setting
from pipeline.noise import looks_like_noise
from pipeline.speakers import names_from_previous, same_person_groups, split_by_speaker
from storage import init_db
from transcripts.edits import overlaps_trashed
from transcripts.store import load_transcript, TRANSCRIPT_LOCK
from voice_memory import restore_line_prints, tv_names, unit, VoiceMemory

# We always hand pyannote in-memory audio, so its torchcodec file decoder is never used.
warnings.filterwarnings("ignore", message=r"(?s).*torchcodec is not installed correctly")

class Engine:
    """Loaded models, reused across days (loading takes a while)."""

    def __init__(self):
        import torch
        import whisperx
        from whisperx.diarize import DiarizationPipeline

        self.torch, self.whisperx = torch, whisperx
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type = "float16" if self.device == "cuda" else "int8"
        log(f"Loading models on {self.device.upper()} (first run downloads several GB)...")
        init_db().close()   # create / migrate the voice DB up front
        self.memory = VoiceMemory()
        self.whisper_model = whisperx.load_model(
            "large-v3", self.device, compute_type=compute_type,
            vad_options={"vad_onset": VAD_ONSET, "vad_offset": VAD_OFFSET})
        self.diarize_model = DiarizationPipeline(token=HF_TOKEN, device=self.device)

    def diarize(self, audio: np.ndarray, hint: dict, report):
        """Run pyannote directly (not via whisperx) to get both of its answers:
        - speaker_diarization: who is talking, overlaps included (several people at once)
        - exclusive_speaker_diarization: exactly one speaker at every moment, which pyannote recommends
          for matching words to speakers.
        Returns (overlap turns, exclusive turns, label -> embedding)."""
        import pandas as pd
        ranges = {"segmentation": (0.0, 50.0), "embeddings": (50.0, 99.0)}
        last = [0.0]

        def hook(step_name, step_artifact, file=None, total=None, completed=None):
            if total and completed is not None:
                a, b = ranges.get(step_name, (0.0, 99.0))
                pct = a + min(completed / total, 1.0) * (b - a)
                if pct > last[0]:
                    last[0] = pct
                    report(pct)

        data = {"waveform": self.torch.from_numpy(audio[None, :]), "sample_rate": SAMPLE_RATE}
        out = self.diarize_model.model(data, hook=hook, **hint)
        report(100)

        def frame(ann):
            return pd.DataFrame([(t.start, t.end, spk) for t, _, spk in ann.itertracks(yield_label=True)],
                                columns=["start", "end", "speaker"])

        labels = out.speaker_diarization.labels()
        emb = ({spk: out.speaker_embeddings[i] for i, spk in enumerate(labels)}
               if out.speaker_embeddings is not None else {})
        return frame(out.speaker_diarization), frame(out.exclusive_speaker_diarization), emb

    def process_day(self, date_key: str, files: list[Path], progress=None, hint: dict | None = None) -> Path:
        """Transcribe one day. `progress(fraction, label)` is called as work advances.
        `hint` may hold num_speakers, or min_speakers / max_speakers, to guide speaker detection."""
        torch, whisperx = self.torch, self.whisperx
        weights = {key: w for key, _, w in STEPS}
        total = sum(weights.values())
        done = {"w": 0}

        json_out = transcript_path(date_key)
        previous = load_transcript(json_out) if json_out.exists() else None
        if hint is None:  # re-transcribing remembers the hint given last time
            hint = (previous or {}).get("speaker_hint") or {}
        hint = {k: int(v) for k, v in hint.items() if k in ("num_speakers", "min_speakers", "max_speakers") and v}

        def step(key: str):
            label = next(l for k, l, _ in STEPS if k == key)
            idx = [k for k, _, _ in STEPS].index(key) + 1
            log(f"  {idx}/{len(STEPS)} {label}...")

            def report(pct: float = 0.0):
                if progress:
                    progress((done["w"] + weights[key] * min(pct, 100) / 100) / total, label)
            report(0)
            return report

        def finish(key: str):
            done["w"] += weights[key]

        try:
            report = step("merge")
            audio_file, sources = prepare_daily_audio(date_key, files)
            audio = whisperx.load_audio(str(audio_file))
            finish("merge")

            report = step("transcribe")
            # Each segment is transcribed with its own speech sensitivity, then put back on the day timeline
            language = setting("language") or None
            self.whisper_model.tokenizer = None   # whisperx would otherwise reuse the previous day's language
            if not language:
                # Whisper guesses the language from 30 s of audio; quiet or noisy openings make it guess
                # wrong (e.g. Norwegian), so give it the 30 s with the most speech energy in the day
                win = 30 * SAMPLE_RATE
                frame = SAMPLE_RATE // 2
                n = len(audio) // frame
                energy = np.sqrt((audio[:n * frame].reshape(-1, frame) ** 2).mean(1)) if n else np.zeros(1)
                per_win = np.convolve(energy, np.ones(60), mode="valid") if len(energy) >= 60 else energy
                start = int(np.argmax(per_win)) * frame if len(per_win) else 0
                language = self.whisper_model.detect_language(audio[start:start + win])
                log(f"      language detected: {language} (from {start / SAMPLE_RATE / 60:.1f} min in)")
            segments, total_secs, done_secs = [], sum(s["duration"] for s in sources) or 1, 0.0
            for src in sources:
                chunk = audio[int(src["start"] * SAMPLE_RATE):int((src["start"] + src["duration"]) * SAMPLE_RATE)]
                if len(chunk) >= SAMPLE_RATE:
                    onset, offset = SENSITIVITY[clip_levels(src["name"])["sensitivity"]]
                    self.whisper_model._vad_params = {**self.whisper_model._vad_params,
                                                      "vad_onset": onset, "vad_offset": offset}
                    part = self.whisper_model.transcribe(
                        chunk, batch_size=16, language=language,
                        progress_callback=lambda p, base=done_secs, d=src["duration"]: report((base + d * p / 100) / total_secs * 100))
                    language = language or part["language"]
                    for seg in part["segments"]:
                        seg["start"] += src["start"]
                        seg["end"] += src["start"]
                        segments.append(seg)
                done_secs += src["duration"]
            language = language or "en"
            result = {"segments": segments, "language": language}
            finish("transcribe")

            report = step("align")
            align_model, metadata = whisperx.load_align_model(language_code=language, device=self.device)
            result = whisperx.align(result["segments"], align_model, metadata, audio, self.device,
                                    return_char_alignments=False, progress_callback=report)
            del align_model
            finish("align")

            report = step("diarize")
            if hint:
                log(f"      speaker hint: {hint}")
            diarize_df, exclusive_df, raw_emb = self.diarize(audio, hint, report)
            finish("diarize")

            report = step("save")
            seconds = (diarize_df.end - diarize_df.start).groupby(diarize_df.speaker).sum().to_dict()
            emb = {l: unit(v) for l, v in (raw_emb or {}).items() if np.all(np.isfinite(v)) and l in seconds}
            # An exact speaker count is the user's call; otherwise join clusters that are the same voice
            if "num_speakers" in hint:
                rep = {l: l for l in emb}
            else:
                rep = same_person_groups(emb, SAME_PERSON_THRESHOLD, hint.get("min_speakers", 0))
            diarize_df["speaker"] = diarize_df["speaker"].map(lambda l: rep.get(l, l))
            exclusive_df["speaker"] = exclusive_df["speaker"].map(lambda l: rep.get(l, l))
            voices: dict[str, tuple[np.ndarray, float]] = {}
            for label in set(rep.values()):
                members = [l for l in rep if rep[l] == label]
                secs = sum(seconds[m] for m in members)
                voices[label] = (unit(sum(emb[m] * seconds[m] for m in members)), secs)

            # Words go to the one speaker pyannote is most sure of at that moment
            result = whisperx.assign_word_speakers(exclusive_df if len(exclusive_df) else diarize_df, result, fill_nearest=True)
            lines = split_by_speaker(result["segments"], language)

            turns = list(zip(diarize_df.start, diarize_df.end, diarize_df.speaker))
            mask = np.load(rustle_mask_path(date_key)) if rustle_mask_path(date_key).exists() else None
            # A "voice" that is mostly rustle is the shirt, not a person: don't give it a voiceprint
            for label in list(voices):
                spans = [(a, b) for a, b, l in turns if l == label]
                secs = sum(b - a for a, b in spans) or 1
                if sum(rustle_share(mask, a, b) * (b - a) for a, b in spans) / secs >= 0.7:
                    log(f"      {label} is mostly clothing rustle; not treated as a person")
                    del voices[label]
            prior = names_from_previous(turns, previous["segments"]) if previous else {}
            prior = {l: n for l, n in prior.items() if l in voices}
            names, voice_info = self.memory.assign(date_key, voices, prior)
            # assign() replaced the day's voiceprints; put back the ones taught from single lines
            line_prints = previous.get("line_prints", []) if previous else []
            if line_prints:
                restore_line_prints(date_key, line_prints)

            # Where diarization heard a voice; Whisper text with no voice under it is invented
            res = 100   # 10 ms
            heard = np.zeros(int(len(audio) / SAMPLE_RATE * res) + 1, bool)
            for a, b, _ in turns:
                heard[int(a * res):int(b * res) + 1] = True

            def voice_share(a, b):
                seg = heard[int(a * res):max(int(b * res), int(a * res) + 1)]
                return float(seg.mean()) if len(seg) else 0.0

            # Who else was talking during a line (people talking over each other)
            by_label: dict[str, list[tuple[float, float]]] = {}
            for a, b, l in turns:
                by_label.setdefault(l, []).append((a, b))

            def talking_over(line):
                a, b = line["start"], line["end"]
                need = max(OVERLAP_MIN_SECONDS, OVERLAP_MIN_SHARE * (b - a))
                others = []
                for l, spans in by_label.items():
                    if l == line["speaker"]:
                        continue
                    secs = sum(max(0.0, min(b, y) - max(a, x)) for x, y in spans if x < b and y > a)
                    if secs >= need:
                        others.append(l)
                return sorted(set(others))

            # Voices recognised as a TV / YouTube profile: lines stay visible, tagged TV in the viewer
            tv = tv_names()
            for l in voices:
                if names[l] in tv:
                    voice_info[l]["tv"] = True
                    log(f"      {l} is TV ('{names[l]}')")

            timeline = []
            for line in lines:
                if not line["text"].strip():
                    continue
                seg = {"start": round(line["start"], 2), "end": round(line["end"], 2),
                       "speaker": names.get(line["speaker"], "Unknown"), "text": line["text"]}
                if looks_like_noise(line["text"], rustle_share(mask, line["start"], line["end"]), line["score"]) \
                        or voice_share(line["start"], line["end"]) < MIN_SPEECH_UNDER_LINE:
                    seg["noise"] = True
                over = talking_over(line)
                if over and not seg.get("noise"):
                    seg["overlap_labels"] = over                                   # source of truth
                    seg["overlap"] = sorted({names.get(l, "Unknown") for l in over})  # names at the time
                timeline.append(seg)

            with TRANSCRIPT_LOCK:
                # Lines the user trashed stay gone after re-transcribing
                latest = load_transcript(json_out) if json_out.exists() else {}
                trashed = latest.get("trashed", [])
                timeline = [seg for seg in timeline if not overlaps_trashed(seg, trashed)]
                tmp_out = json_out.with_suffix(".tmp")
                tmp_out.write_text(json.dumps({
                    "date": date_key,
                    "language": language,
                    "audio": audio_file.name,
                    "speaker_hint": hint,
                    "sources": sources,
                    "recordings": [{"name": f.name, "bytes": f.stat().st_size} for f in files],
                    "segments": timeline,
                    "trashed": trashed,
                    "line_prints": latest.get("line_prints", line_prints),   # incl. any taught while this ran
                    "voices_reviewed": False,   # the viewer opens the voice review the first time this day is opened
                    # Per voice: how sure the match was and who else it might be (viewer suggestions)
                    "voices": [{"name": names[l], "label": l, "seconds": round(voices[l][1], 1), **voice_info[l],
                                "embedding": [round(float(x), 5) for x in unit(voices[l][0])]}
                               for l in voices],
                }, indent=2, ensure_ascii=False), encoding="utf-8")
                tmp_out.replace(json_out)
            finish("save")
            if progress:
                progress(1.0, "Done")
            log(f"  Done -> {json_out}  ({len(set(names.values()))} speakers, {len(timeline)} lines)")
            return json_out
        finally:
            if self.device == "cuda":
                torch.cuda.empty_cache()
