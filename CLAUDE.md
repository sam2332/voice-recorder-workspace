# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read [Mistakes.md](Mistakes.md) before changing anything.** It lists mistakes already made on this project and the rules that prevent them. The most important are: ask the user clarifying questions before building, test on real recordings, and never point tests at the real data folders or voice DB.

## Overview

A personal pipeline for voice-recorder audio. It has two pieces:

- **Python** (`IngressScript/`): WhisperX + pyannote transcription with cross-day speaker identity, a FastAPI/uvicorn server that hosts the viewer, and a background worker that transcribes days. `app.py` is only the CLI; the code lives in small packages, each module with a one-line docstring:
  - `core/` config (paths, thresholds, patterns), settings (`settings.json`), paths (`day_dir()` etc.);
  - `audio/` files, merge, rustle, levels, analysis, segments;
  - `pipeline/` engine (`Engine.process_day`), speakers (pure helpers), noise, checks, batch (`process_all`), processor (server worker);
  - `transcripts/` store (load/write, `TRANSCRIPT_LOCK`; importing the package wires `voice_memory`), edits, people;
  - `llm/` ollama, markdown, summary, extract, workers; `meetings/` store, summary; `recorder_sync/`;
  - `voice_memory/`, `storage.py`, `app_config.py` (voice DB and matching thresholds);
  - `web/` app (`create_app`, starts the workers), models (request bodies), deps (`check_date`, `safe_file`), one `routes_*.py` per area, each exposing `build(ctx) -> APIRouter`, server (`serve`).

  Imports between packages form no cycles; keep it that way (`from x import y` cycles fail at startup).
- **Viewer** (`IngressScript/frontend/src/*.ts`, ~60 TypeScript modules): bundled by esbuild into `static/viewer.js`, with `frontend/src/styles/*.css` bundled into `static/viewer.css`. The page is `templates/viewer.html` plus `templates/partials/` and `templates/dialogs/` (Jinja includes). It has three areas:
  - a library of days;
  - a transcript synced to the audio;
  - a day details panel (recordings, speakers, re-transcribe).

  The viewer only runs from the server (it will be hosted remotely). There is no `file://` mode: the old folder-picker mode was removed on purpose. Until `/api/library` answers, the start card says "Loading…"; if it fails, it shows the error and a Try again button. `state.server` means "the library has loaded", and many functions return early until it's true.
  - All page state is the one typed `state` object in `core/state.ts`; JSON shapes from the server are in `core/types.ts`. `$('id')` returns a broad element type; narrow it with `$<HTMLCanvasElement>('id')` when needed.
  - Modules only *declare* things at load. Anything that runs at load (event wiring) goes in that module's `export function init()`, and `main.ts` calls every `init()` in order. This keeps import order from causing TDZ errors.
  - ES imports are read-only: a `let` another module needs to change must get a setter or move into `state`.
  - `static/viewer.js` and `static/viewer.css` are build output, committed so the app runs without Node. Never edit them by hand.

There is no test suite or linter. The platform is Windows; use the venv at `.venv` (Python 3.12).

## Commands

```powershell
.venv\Scripts\python IngressScript\app.py              # viewer on :5000 now; watcher queues new/incomplete days
.venv\Scripts\python IngressScript\app.py --serve --no-browser --port 5055   # viewer only, no auto-processing
.venv\Scripts\python IngressScript\app.py --no-serve [--force] [--min-speakers N]   # batch in the terminal
.venv\Scripts\python IngressScript\app.py --speakers | --rename OLD NEW | --merge OLD INTO
.venv\Scripts\python -m compileall -q IngressScript   # syntax check every module
cd IngressScript\frontend; npm install                # once: typescript + esbuild
npm run build      # tsc --noEmit (must be 0 errors), then bundle JS and CSS into ../static
npm run watch      # rebuild viewer.js on save while working
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

1. **Merge.** The ffmpeg *concat filter* decodes and resamples every input, so MP3 and WAV can be mixed on one day; the concat demuxer cannot do that. The audio then goes through `highpass` and `speechnorm` into `<date>/merged.wav` (16 kHz mono).
   - `derustle_wav` then suppresses clothing rustle in place, working in 10-minute pieces. A stretch counts as rustle when the energy above 2.5 kHz is more than 1.5× the 100–1000 Hz energy and lasts at least 240 ms (shorter bursts are 's' sounds). Over rustle, the band above 2.5 kHz is pulled down toward 0.3× the voice band and the 1–2.5 kHz band is half-cut; the voice band is never touched.
   - It writes `<date>/rustle.npy`: one bool per 256 samples.
   - `<date>/merged.sources.json` records the recordings (name and size) plus `RUSTLE_STRENGTH`, so the WAV is rebuilt only when either changes.
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
7. **Save** `<date>/transcript.json` under `TRANSCRIPT_LOCK`, writing to a temp file and then renaming. It includes `speaker_hint`, which a later re-transcribe reuses, and `trashed`. New lines that overlap a trashed line by at least 50% are dropped (`overlaps_trashed`), so removed lines stay removed.

**Output layout** (the user moved to this by hand; there is no automatic migration):
`processed_daily/<YYYY-MM-DD>/{transcript.json, merged.wav, merged.sources.json, rustle.npy, summary.json}` plus `processed_daily/clip_levels.json`, which is shared by all days.
- Always go through `day_dir()`, `transcript_path()`, `all_transcripts()`, `rustle_mask_path()` and `summary_path()`; never build `OUTPUT_DIR / f"{date}_..."` by hand.
- Day audio is served at `/audio/<date>/<file>?v=<mtime>`.

**Overlapping speech:** `Engine.diarize()` calls the pyannote pipeline directly, not whisperx's wrapper, to get both of its outputs:
- `exclusive_speaker_diarization` assigns each word to one speaker, as pyannote recommends for ASR alignment. On the real call it fixed back-channel replies ("Perfect.", "Oh, that's pretty fancy.") that had landed on the wrong person.
- `speaker_diarization` (with overlaps) drives voice share, rustle checks and `seg["overlap"] = [names]`, which is set when another voice talks for at least `OVERLAP_MIN_SECONDS` / `OVERLAP_MIN_SHARE` of a line. The viewer shows it as a "talking over: X" tag.
- Speech separation (`pyannote/speech-separation-ami-1.0`, which would transcribe both overlapping voices) was offered and not chosen.

**Global voice profiles:**
- Each transcript's `voices[]` stores every voice's `embedding` (256 floats). `voiceprints.label` records which diarization voice a print came from; `init_db` adds the column with `ALTER TABLE` on older databases.
- Naming a voice in the day's dropdown calls `relabel_speaker` (lines on that day only) **and** `teach_voice`, which moves that day's print for those labels to the named person's profile, so new days auto-tag them.
- Undo sends `labels` and moves the print back. For older transcripts without embeddings, the day's print the old name had is moved instead.
- `forget_unused_speakers` deletes profiles with no prints that no transcript uses.
- Verified on scratch copies: naming the caller "Jake" on Oct 2 made a new day auto-tag "Jake".

**Day summaries (local Ollama):** `Summarizer` runs one summary at a time in a thread.
- **Model call:** `ollama_chat` streams from `OLLAMA_URL` / `OLLAMA_MODEL` (default `qwen3.5:35b-a3b`) with `think: false`, `num_predict` capped, `repeat_penalty` 1.1 and `keep_alive` 2m, so VRAM is freed for transcription. An uncapped call once ran for 10+ minutes.
- **Speed on this PC:** about 120 tokens/s reading and 18 tokens/s writing (14 of 24 GB on the GPU). The 37-minute Oct 2 day took 42 s.
- **Prompt:** transcript lines are sent as `[L12] 9:43 AM Name: text`. Days longer than `SUMMARY_CHUNK_CHARS` are summarised as per-part notes, which are then merged.
- **Output:** the model cites `[L12]`, `[L12, L15]` or ranges like `[L30-L45]`, and `refs` maps them to seconds. `drop_empty_sections` removes "No items mentioned" sections, including on read.
- **Stored:** `<date>/summary.json`, with a `fingerprint` of (speaker, text) for non-noise lines; when it no longer matches, the viewer shows "outdated · Regenerate".
- **Sections:** Overview, Conversations, Shopping list (things said to be out of or needed), Project ideas (the user's own ideas, not work being explained), To-dos, Decisions & key facts. Viewer: the small `renderMarkdown()` DOM renderer, clickable time chips, and task checkboxes remembered in `localStorage`.

**Real-data lessons (2026-10-02: a quiet morning, then a phone call). Test on real recordings, not only synthetic clips:**
- **Language:** whisperx detects the language from the first 30 s; a near-silent start gave Norwegian and invented lines such as "Teksting av Nicolai Winther". The default setting is now `"en"` (the user records in English). With auto-detect, `detect_language` is given the 30 s window with the most speech energy.
- **Invented text:** lines with less than `MIN_SPEECH_UNDER_LINE` (0.3) of their duration covered by diarization turns are flagged as noise (`voice_share`), and so is anything containing a phrase from `HALLUCINATIONS`. `fill_nearest=True` would otherwise give every invented line a speaker.
- **Phantom people:** a voice with less than `MIN_VOICE_SECONDS` (20 s) of speech is never enrolled. It becomes "Unknown voice N" (one label per voice, not stored in the DB, excluded from People and pickers). `names_from_previous` ignores names starting with "Unknown".
- **Matching:** an automatic match needs `MATCH_THRESHOLD` = 0.68; the old 0.55 produced false matches. Candidates scoring at least `SUGGEST_THRESHOLD` (0.45) are saved in the transcript as `voices: [{name, label, seconds, match, candidates}]`. The viewer shows them as "Recognised by voice · 80%" or "Maybe X? 46%", and as a "Suggested by voice" group in the dropdown.
- **Speaker changes:** `split_by_speaker` only changes speaker at sentence-ending punctuation or after a gap of at least 0.5 s, which fixes "Oh, that's pretty" / "fancy." splits.
- **Known weakness:** one-word back-channel replies ("Perfect.", "Yeah.") can land on the other speaker.
- **Stale audio:** browsers cached the old 2-minute merged WAV after a day was rebuilt with more recordings. `audio_url` and `recordings` URLs now carry `?v=<mtime>`, and responses send `Cache-Control: no-cache`.
- **Research:** DiariZen scores best among open diarizers, but needs Python 3.10, torch 2.1, a forked pyannote and non-commercial weights, so it was not adopted. pyannote community-1 plus the fixes above was the better trade-off.

**Voice review (after transcribing):** `process_day` saves `voices_reviewed: false`. The library reports `needs_review` (a "Name voices" chip on Home); transcripts without the flag are treated as reviewed.
- The first time such a day is opened, the viewer pops up `#voices-dlg` (`openVoiceReview`); the day's "Review voices…" button reopens it.
- One card per voice, for the whole day, listing which recordings it's in. Unsure voices (no match, not `named`) are open at the top. Matched or user-named voices are folded below; "Looks right" is client-side only.
- Snippets: `voiceSnippets` picks non-noise lines with no overlap, longest first (2–15 s preferred), 5 at a time. They play through a separate `Audio`, so the main player keeps its position.
- Naming uses the normal `whoPicker` → `relabelVoice` (day relabel + `teach_voice`, which sets `voices[].named`).
- "Done" posts `POST /api/days/{date}/voices/reviewed`. It is wired to the button's click: the dialog `close` event never fired in the desktop app's built-in browser.

**TV / YouTube voices:** `speakers.kind = 'tv'` (column added by `init_db`) marks a voice profile as TV. These profiles are matched like people, one per channel or show.
- TV lines are **not** noise. They stay visible with a TV badge, the overview extraction reads them labelled "(on TV/YouTube)", and they're left out of the overview's "who I saw" (that's the user's choice: "make tv/music its own person so i can extract important things from it").
- In the voice picker, "TV / YouTube" calls `POST /api/days/{date}/tv-voice {speaker, name}`. That runs `mark_tv`, `relabel_speaker` and `teach_voice`, then un-hides that voice's lines (`mark_speaker_noise(..., False)`) and sets `voices[].tv`. It refuses with a 409 if `name` is an existing person. Undo is `voice-noise {noise:true, lines: shown}` followed by `relabel {lines: changed, labels}`.
- `process_day` only sets `voices[].tv` for matched TV voices.
- `/api/speakers` returns `tv` separately and leaves TV names out of `speakers`.
- **Voice profiles on the People page:** `GET /api/voices` → `voice_profiles()` lists every DB profile and its prints. Each print comes with up to 3 clean sample lines of the voice it was learned from on that day (found through `voices[].label`) and `audio`. Other routes:
  - `DELETE /api/voices/prints/{id}` removes one print;
  - `POST /api/voices/kind {name, tv}` switches between TV and person;
  - `POST /api/voices/delete {name}` deletes the profile (transcripts keep the name);
  - rename and merge use `/api/speakers/rename`.

  People are grouped into People and TV / YouTube, and profiles that no transcript uses still get a card.
- "Just hide (don't learn)" is the old per-day noise flag. The line editor's "TV / music: hide this line" flags one line only and does not learn.
- Voices only: instrumental music isn't recognised.

**Splitting a mixed voice:** diarization sometimes lumps several quiet people into one voice (real case: Speaker_3 on 2026-09-30).
- **Why not automatic:** on that day only 65 of Speaker_3's 194 lines were at least 1.5 s with no overlap. Blind clustering gave a silhouette of about 0.08, and 62 of the 65 lines matched no known profile confidently.
- **What exists instead:** a seeded split plus a keyboard sort mode (the user's choice). It's reached through a "Split…" button in the Speakers panel and "Several people? Split…" in voice review, and opens `#split-dlg`.
  - The user names up to 4 people and sorts lines longest first: keys 1–4 assign, S skips, Z goes back, Space replays, Enter accepts the suggestion. Each line auto-plays via `playSnip`.
  - "Suggest the rest by voice" calls `POST /api/days/{date}/voice-split {speaker, seeds: {person: [{start,text}]}}` → `split_voice`. Each line of at least `SPLIT_MIN_SECONDS` is scored against each person's tagged lines (mean of the 3 closest) and their saved profile (minus this day's print of the mixed voice). The best one is suggested at `SPLIT_MATCH` 0.35 or more and `SPLIT_MARGIN` 0.05 or more; strong suggestions need 0.55 and 0.15.
  - Save is one `replaceLines` (with Undo), then `voice-train` per person. Undo does not un-teach.
- **Calibration:** on a scratch copy, Lily, Mia and Steve were merged into one fake voice and tagged by 3 lines each. 451 of 782 lines were suggested and 449 were right. With 6 tags each, 623 were suggested and 618 were right. These voices are clear, and quiet ones score lower.

**Teaching voices from single lines:** moving a line to someone in the line editor adds it to a per-day tray (`localStorage` `teach:<date>`). "Teach voices…" opens `#teach-dlg`:
- **Stage 1** `POST /api/days/{date}/voice-train {person, lines, remove}` → `train_lines`. Each line of `MIN_TRAIN_LINE_SECONDS` (2 s) or more with no overlap is embedded by `LineVoices`. That is only the community-1 wespeaker model, the same embedding space as the diarization centroids, cached per day by merged.wav mtime. The embeddings go into the transcript's `line_prints`, and each person gets one weighted-mean voiceprint per day with `label='lines'`. `process_day` carries `line_prints` over and calls `restore_line_prints` after `assign()`, so a re-transcribe keeps them.
- **Stage 2** `POST /api/days/{date}/voice-similar {person}` → `similar_lines`: lines of the day scoring `LINE_MATCH_THRESHOLD` (0.45) or more against the person, and at least `LINE_MATCH_MARGIN` (0.2) above their current speaker. Lines scoring 0.6 or more come pre-ticked. Ticked lines move through `replaceLines`; moved suggestions are not trained on.
- **Calibration:** on a scratch copy of 2026-10-01 with 15 of Kenzie's lines moved to Lily, it found 11 of them plus 1 wrong line, and other people got no suggestions. Lines of about 1 s score 0.2–0.5 even against the right person.

**Speakers and people:**
- **Day-only relabel:** `relabel_speaker(date, old, new, lines=None)`, exposed as `POST /api/days/{date}/relabel`, changes the speaker on one day's lines (trashed lines included) and nothing else: no voiceprints, no other days. That was the user's choice for "who is this voice". Undo passes the exact `lines` returned, so a person who already existed on that day isn't relabelled too.
  - A later re-transcribe carries these names over through `names_from_previous`, at which point that day's voiceprint gets stored under the chosen name.
  - The global, permanent merge is still `rename_speaker_core(merge=True)`, reached by double-click rename.
- **People:** `people_summary()` (`GET /api/people`) aggregates every transcript, skipping noise lines and "Unknown". Each person gets per-day seconds and lines, plus the recordings they speak in (matched through `sources` offsets), with `first_line` used to seek there. `voiceprints == 0` means "name only", i.e. a name that exists only through relabels.
- `GET /api/speakers` returns the DB names plus every transcript name, feeding both pickers.
- **Viewer routing:** `#people` → `showPeople()`, which renders into the Home container under `.is-home`. `go(date, seekTo)` sets `state.pendingSeek`, which `openDay` applies after the audio loads. `heatGrid(counts, {title, cls, onClick, levels})` is the shared GitHub-style grid used by Home and by each person.

**Text edits:**
- `edit_lines(..., "replace", new)` swaps the identified lines for `new`, and refuses with a 409 if any of them changed since the page loaded. Edit, change speaker, split, join and undo are all client-side `replaceLines(old, new)` calls; undo is the inverse replace.
- **Split** divides the time in proportion to where the cursor sits in the text, since word timings aren't stored.
- Edited lines carry `edited: true`. `has_edits(date)` makes the watcher skip auto re-transcribing those days. Manual Re-transcribe warns ("Replace my edits and start") and then overwrites the edits; trashed lines and names still carry over.
- `GET /api/speakers` feeds the editor's who-said-it picker. Moving a line to a speaker changes only the transcript, not voiceprints.

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

**Transcript JSON contract** (the viewer depends on it; mirrored in `frontend/src/core/types.ts`, so update both):

```json
{"date": "YYYY-MM-DD", "language": "en", "audio": "merged.wav", "speaker_hint": {"min_speakers": 6},
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
- **Auto-adjust:** `auto_levels(analysis)` is measure-based only; nothing is test-transcribed.
  - Volume brings speech to −18 dBFS, but only outside the −24..−8 dead zone.
  - Sensitivity: High at SNR ≥ 30, Low below 18.
  - Gate: floor + 3 dB, only when the floor after gain is above −45.
  - Rustle: Maximum at ≥ 10% rustle, Strong at ≥ 2%, otherwise Gentle.
  - Declip whenever the clip is clipped.

  It returns `problems`, and `confident` means there are none. The worker calls `flagged_clips(autofix=True)`, which saves confident fixes as `{…, auto: true, reviewed: true}` and only blocks on the rest (the user's choice: "don't pause if it fixed it"). In the UI, the Auto-adjust button is the only way to apply rules otherwise.
- **Rustle Maximum:** strength `RUSTLE_MAXIMUM` = 2.0. Detection triggers at high band > 1.0× voice band (instead of 1.5×), the target ratio is 0.1, cuts go up to 45 dB, the 1–2.5 kHz band gets the full cut, and frames that are rustle with no voice (`v < 0.25·h`) are ducked by `RUSTLE_DUCK` (−20 dB) in every band. Measured on a raw 51-minute recording:
  - rustle-only stretches −14.9 dB (Strong: −9.6 dB);
  - speech under rustle loses ≤ 1 dB of voice band;
  - none of 475 clean lines was hurt by more than 3 dB.
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
