# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A personal pipeline for voice-recorder audio. It has two pieces:

- `IngressScript/app.py`: WhisperX + pyannote transcription with cross-day speaker identity. It also includes a FastAPI/uvicorn server that hosts the viewer, plus a background worker that transcribes days.
- `IngressScript/viewer.html`: a single-file, dependency-free browser app. It has three areas:
  - a library of days;
  - a transcript synced to the audio;
  - a day details panel (recordings, speakers, re-transcribe).

  It has two modes:
  - **Server mode**, used when the page is loaded over `http(s)`: it adds `body.server`.
  - **File mode**, used when opened from `file://`: the user picks or drops the `processed_daily` folder.

  Elements marked `.file-only` or `.server-only` are toggled by the mode. All page state lives inside an IIFE, and there is no global API.

There is no build step, test suite or linter. The platform is Windows; use the venv at `.venv` (Python 3.12). Docker (`docker compose up -d --build`) runs the same app on Linux with the GPU.

## Commands

```powershell
.venv\Scripts\python IngressScript\app.py              # viewer on :5000 now; watcher queues new/incomplete days
.venv\Scripts\python IngressScript\app.py --serve --no-browser --port 5055   # viewer only, no auto-processing
.venv\Scripts\python IngressScript\app.py --no-serve [--force] [--min-speakers N]   # batch in the terminal
.venv\Scripts\python IngressScript\app.py --speakers | --rename OLD NEW | --merge OLD INTO
.venv\Scripts\python -m py_compile IngressScript\app.py
docker compose up -d --build; docker compose logs -f
```

A full run needs:
- `HF_TOKEN`, loaded from `.env` by python-dotenv and passed by compose through `env_file`;
- ffmpeg and ffprobe;
- several GB of models.

A 2.5-hour day takes about 4 minutes to diarize on the RTX 5060 Ti.

**Testing safely:** always point `RECORD_DIR`, `OUTPUT_DIR` and `SPEAKER_DB` at scratch locations. The user's real `IngressScript/speaker_memory.db` holds enrolled voices that cannot be rebuilt, and renames and transcriptions write to it.
- Pure functions can be exercised without models: `split_by_speaker`, `same_person_groups`, `names_from_previous`, `VoiceMemory.assign` (with fake unit vectors), `rename_speaker_core`, `get_daily_batches` and `prepare_daily_audio`.
- A good audio fixture is copies of one small MP3, plus an ffmpeg-converted 48 kHz stereo WAV, renamed to different dates.

## Architecture

**Recordings:** files match `V<YYYY-MM-DD>-<HH>-<MM>-<SS>.(MP3|WAV)`, which is the recorder's naming; `BIT:7` produces 48 kHz stereo WAV. Recordings shorter than `MIN_RECORDING_SECONDS` (measured with ffprobe and cached) are skipped. Within a day, files are sorted by the timestamp in their name.

**Pipeline (`Engine.process_day`):** the `STEPS` weights drive the progress bar. `Engine` loads the models once and is shared by `process_all` (CLI) and `Processor` (the server's single worker thread and queue).

1. **Merge.** The ffmpeg *concat filter* decodes and resamples every input, so MP3 and WAV can be mixed on one day; the concat demuxer cannot do that. The audio then goes through `highpass` and `speechnorm` into `<date>_merged.wav` (16 kHz mono). `<date>_merged.sources.json` records which recordings went in, so the WAV is rebuilt only when that list changes.
2. **Transcribe and align** with WhisperX. Voice-activity detection uses `VAD_ONSET` and `VAD_OFFSET`, which are lowered so quiet speech is picked up. `LANGUAGE` is optional.
3. **Diarize** with `whisperx.diarize.DiarizationPipeline(..., return_embeddings=True, **hint)`.
   - The returned per-speaker centroids (wespeaker embeddings averaged over clean, non-overlapping speech) *are* the voiceprints; there is no separate embedding model.
   - `same_person_groups` re-joins clusters with cosine similarity ≥ `SAME_PERSON_THRESHOLD`, which fixes diarization splitting one person in two. It never merges below `min_speakers`, and it is skipped entirely when `num_speakers` is given.
4. **Words.** `assign_word_speakers(fill_nearest=True)`, then `split_by_speaker` breaks Whisper segments wherever the word-level speaker changes. Runs of 1–2 words lasting under 0.6 s are absorbed as boundary jitter.
5. **Identity.** `names_from_previous` carries names over from the day's old transcript by time overlap, one-to-one, so user renames survive a re-transcribe. Then `VoiceMemory.assign`:
   - deletes this day's old voiceprints;
   - matches voices one-to-one, best score first, using the mean of the 3 closest voiceprints with `MATCH_THRESHOLD`;
   - enrols the rest as `Speaker_N`;
   - stores one voiceprint per person per day (capped at `MAX_VOICEPRINTS`);
   - deletes speakers that have no voiceprints and appear in no transcript.
6. **Save** `<date>_transcript.json` (written to a temp file, then renamed), including `speaker_hint`, which a later re-transcribe reuses.

**Experiment findings on the real 2026-08-20 day:**
- The default pyannote clustering found 5 clusters, two of which were the same person (similarity 0.83).
- Forcing 6 speakers re-split that same person (0.84) rather than finding a new voice.
- Lowering the clustering `threshold` from 0.6 to 0.5 changed nothing.
- Distinct people score ≤ 0.65 against each other, and splits of one person score ≥ 0.83. That gap is why `SAME_PERSON_THRESHOLD` is 0.75.

**Voice DB (SQLite):**
- `speakers(id, name UNIQUE, …)` and `voiceprints(speaker_id, embedding, seconds, day, created)`.
- The old single-centroid `speakers.embedding` column was migrated to a `day='legacy'` voiceprint. Legacy prints are ignored once a person has real ones, and are deleted when that person gets a new one.
- `rename_speaker_core(old, new, merge)` raises `NameTaken` (HTTP 409) if `new` already exists. With `merge=True` it moves the voiceprints across and rewrites every transcript.

**Transcript JSON contract** (`viewer.html` depends on it):

```json
{"date": "YYYY-MM-DD", "language": "en", "audio": "<date>_merged.wav", "speaker_hint": {"min_speakers": 6},
 "sources": [{"name": "V....WAV", "start": 0.0, "duration": 3120.5, "recorded_at": "06:18:54", "bytes": 123}],
 "segments": [{"start": 0.0, "end": 1.2, "speaker": "Speaker_1", "text": "..."}]}
```

- `sources[].start` is each recording's offset inside the merged WAV. The viewer uses it for wall-clock times, dividers and timeline ticks.
- `bytes` lets `needs_processing` notice that a recording has grown since the day was transcribed (for example, it was still being copied).
- Older transcripts that store `sources` as plain filenames are upgraded on the fly by `transcript_sources()`.

**Server and background processing:**
- By default `serve(auto_process=True)` starts `Processor.watch()`. Every 30 s it queues any day where `needs_processing` is true.
- It skips days whose files changed in the last 60 s (still copying).
- It does not retry a failed day until that day's files change, or until the user retries from the UI.

**Server routes:**

| Route | Purpose |
|---|---|
| `GET /api/library` | Every day with its status and `job` state, plus `jobs`: `{current, queued}` for the header progress pill. |
| `GET /api/days/{date}` | A transcript, or the sources of a pending day. |
| `POST` / `DELETE /api/days/{date}/process` | Queue a day or remove it from the queue. The `POST` body is `{hint}`, where `null` reuses the previous hint and `{}` means auto. |
| `GET /audio/{name}`, `GET /recordings/{name}` | Range-capable file responses. |
| `POST /api/speakers/rename` | Body `{old, new, merge}`. |

**Docker:**
- The image is `nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04`, with the venv at `/opt/venv`.
- `RECORD_PATH` (default `./RECORD`) is mounted read-only at `/data/RECORD`.
- `./IngressScript` is mounted at `/data/state`, so local and Docker runs share transcripts and the DB.
- The model cache is a named volume mounted at `/models` (`HF_HOME`).
- The port is published on `127.0.0.1` only.

## Library version gotchas

- pyannote.audio 4.x and whisperx 3.8 take `token=`, not `use_auth_token=`. `DiarizationPipeline` is in `whisperx.diarize`.
- `torch`, `whisperx` and `pyannote` are imported lazily inside `Engine`, so the CLI and server start instantly. Keep heavy imports out of module scope.
- `model_access_problems()` calls `HfApi.auth_check`. A 403 means a fine-grained token without "public gated repos" read access.
- The torchcodec warning is expected on Windows and is filtered out. Audio is always handed to pyannote as an in-memory waveform.
- whisperx 3.8.6 pins `torch~=2.8.0`. `requirements.txt` uses the cu128 index; uv also needs `--index-strategy unsafe-best-match`.
- When editing these files through Bash heredocs, escape sequences such as `\n` inside Python string literals have come out as real newlines. Use the Edit tool for lines that contain escapes.
