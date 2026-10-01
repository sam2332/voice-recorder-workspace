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

There is no build step, test suite or linter. The platform is Windows; use the venv at `.venv` (Python 3.12).

## Commands

```powershell
.venv\Scripts\python IngressScript\app.py              # viewer on :5000 now; watcher queues new/incomplete days
.venv\Scripts\python IngressScript\app.py --serve --no-browser --port 5055   # viewer only, no auto-processing
.venv\Scripts\python IngressScript\app.py --no-serve [--force] [--min-speakers N]   # batch in the terminal
.venv\Scripts\python IngressScript\app.py --speakers | --rename OLD NEW | --merge OLD INTO
.venv\Scripts\python -m py_compile IngressScript\app.py
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

1. **Merge.** The ffmpeg *concat filter* decodes and resamples every input, so MP3 and WAV can be mixed on one day; the concat demuxer cannot do that. The audio then goes through `highpass` and `speechnorm` into `<date>_merged.wav` (16 kHz mono).
   - `derustle_wav` then suppresses clothing rustle in place, working in 10-minute pieces. A stretch counts as rustle when the energy above 2.5 kHz is more than 1.5× the 100–1000 Hz energy and lasts at least 240 ms (shorter bursts are 's' sounds). Over rustle, the band above 2.5 kHz is pulled down toward 0.3× the voice band and the 1–2.5 kHz band is half-cut; the voice band is never touched.
   - It writes `<date>_rustle.npy`: one bool per 256 samples.
   - `<date>_merged.sources.json` records the recordings (name and size) plus `RUSTLE_STRENGTH`, so the WAV is rebuilt only when either changes.
   - Measured on the real 2026-08-20 day: noisy lines lost 15–28 dB of hiss, and 705 clean lines showed 0.0 dB change.
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
6. **Noise.** A diarized "voice" whose turns are at least 70% rustle gets no voiceprint. Each line is checked by `looks_like_noise(text, rustle_share, word score)`:
   - `NOISE_PHRASES` (Whisper hallucinations such as "Thank you.") count as noise when the line is in rustle or has a weak alignment score;
   - `NOISE_IF_RUSTLE` (common real words) count only when the line is in rustle;
   - any line of 4 or fewer words that is mostly rustle counts.

   Such lines get `"noise": true`. The viewer hides them by default, and they are excluded from talk time and the speaker count.
7. **Save** `<date>_transcript.json` under `TRANSCRIPT_LOCK`, writing to a temp file and then renaming. It includes `speaker_hint`, which a later re-transcribe reuses, and `trashed`. New lines that overlap a trashed line by at least 50% are dropped (`overlaps_trashed`), so removed lines stay removed.

**Line edits:** `edit_lines(date, items, action)` identifies a line by its start time (±0.02 s) and text. It is exposed as `POST /api/days/{date}/lines` with body `{action: trash|restore|keep, items: [{start, text}]}`. `restore` also clears the `noise` flag. All transcript writes, including rename and merge, go through `TRANSCRIPT_LOCK` and `write_transcript`.

**Experiment findings on the real 2026-08-20 day:**
- The default pyannote clustering found 5 clusters, two of which were the same person (similarity 0.83).
- Forcing 6 speakers re-split that same person (0.84) rather than finding a new voice.
- Lowering the clustering `threshold` from 0.6 to 0.5 changed nothing.
- Lowering VBx `Fb` to 0.3 gave 11 clusters, five of them tiny fragments of 0.3–0.9 minutes. Pyannote's default clustering parameters are therefore kept, and the reliable sensitivity control is the user's speaker-count hint.
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

**Settings:**
- `settings.json` sits next to the voice DB (`SETTINGS_PATH`). It holds `setup_done`, `auto_transcribe`, `language` and `rustle_strength`, edited through `GET` and `POST /api/settings`.
- Read it with `setting(key)` at runtime; don't cache it in constants.
- The watcher queues nothing until `auto_transcribe` is true. That is the "nothing happens before setup" guarantee.
- Env `LANGUAGE` and `RUSTLE_STRENGTH` only seed the defaults.

**Per-recording levels:** stored in `OUTPUT_DIR/clip_levels.json`, keyed by recording filename, as `{gain_db, sensitivity 1–5, rustle (null = global), gate_db (null = off), declip, reviewed}`.
- **Merge step:** `clip_chain()` builds each input's ffmpeg chain: `adeclip` → resample/mono → `volume` and a hard `asoftclip` (too much gain really clips) → `agate`. The merge manifest includes the levels, so changing them rebuilds the WAV. `derustle_wav(path, regions)` applies each clip's own rustle strength.
- **Transcribe step:** each clip is transcribed separately with `SENSITIVITY[level]` written into `whisper_model._vad_params`, and timestamps are shifted onto the day timeline. `whisper_model.tokenizer` is reset per day; otherwise whisperx silently reuses the first day's language.
- **`analyze_clip()`:** measures speech level (95th-percentile 50 ms RMS), noise floor (10th percentile), peak and clipping, where clipping means runs of 3 or more samples at ≥0.98 of full scale in the *original* file. It returns `issues`, a `suggested` fix and a 1000-bucket waveform (peaks/RMS). Results are cached per file version.
- **Thresholds:** `QUIET_SPEECH_DB = -32`, `NOISY_FLOOR_DB = -38`, `CLIPPED_PCT = 0.05`. They were calibrated on the user's real recordings: speech −14 to −22 dBFS, floor −44 to −69 dBFS, no clipping. On a −25 dB test copy, the suggested +19 dB with High sensitivity transcribed *more* than the untouched clip did at Normal.
- **Blocking:** in `Processor._run`, a day with unreviewed `flagged_clips()` sets `processor.blocked` and the thread waits on `processor.unblock`, which `POST /api/blocked {continue|skip}` sets. The day is re-queued at the front, so the whole queue stops (the user's choice). `jobs.blocked` makes the viewer open the dialog in blocked mode on any page. That mode can't be dismissed with Esc.
- **Routes:** `GET /api/days/{date}/clips` (analysis plus levels per clip), `POST /api/levels {levels, reviewed}`, `GET /api/clips/{name}/preview?start&gain_db&gate_db&rustle&declip` (10 s WAV through the real chain, speechnorm and rustle).

**Recorder sync:**
- `find_recorders()` checks every removable or fixed drive (`GetLogicalDrives`/`GetDriveTypeW` on Windows; `/media`, `/mnt` and similar elsewhere), plus `SYNC_SOURCES`. A drive counts as a recorder when its root has a `RECORD` folder and `SETTINGS.TXT`, matched case-insensitively. The local `RECORD_DIR` is excluded.
- `Syncer` copies each file to `<name>.part` in 4 MB chunks with progress, runs `copystat` (so the watcher doesn't wait out its 60 s settle time), checks the size, then renames. With `SYNC_MODE=move` it deletes the source only after that check.
- Routes: `GET /api/sync` returns `{recorders, job, mode}`; `POST /api/sync` takes `{root}`.
- Docker support was removed: Docker Desktop on Windows cannot see removable drives (even with an explicit `E:/` bind mount), so sync could not work there.

**Viewer home:**
- With no `#date` in the URL the app opens on Home (`state.view = 'home'`, `.app.is-home`). Home shows setup, sync, the activity grid (`activityCard`: 53 week columns × 7 rows, levels 1 / 2–3 / 4–6 / 7+ recordings), transcription status and recent days.
- Home polls every 5 s. `renderHome` reuses the form nodes (`cachedForm`) and skips redrawing while a form control has focus, so in-progress choices survive.

**Server and background processing:**
- By default `serve(auto_process=True)` starts `Processor.watch()`. While `auto_transcribe` is on, it queues any day where `needs_processing` is true every 30 s.
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

## Library version gotchas

- pyannote.audio 4.x and whisperx 3.8 take `token=`, not `use_auth_token=`. `DiarizationPipeline` is in `whisperx.diarize`.
- `torch`, `whisperx` and `pyannote` are imported lazily inside `Engine`, so the CLI and server start instantly. Keep heavy imports out of module scope.
- `model_access_problems()` calls `HfApi.auth_check`. A 403 means a fine-grained token without "public gated repos" read access.
- The torchcodec warning is expected on Windows and is filtered out. Audio is always handed to pyannote as an in-memory waveform.
- whisperx 3.8.6 pins `torch~=2.8.0`. `requirements.txt` uses the cu128 index; uv also needs `--index-strategy unsafe-best-match`.
- When editing these files through Bash heredocs, escape sequences such as `\n` inside Python string literals have come out as real newlines. Use the Edit tool for lines that contain escapes.
