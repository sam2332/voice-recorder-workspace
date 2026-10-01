# Voice Recorder Transcripts

Turns a day's worth of voice-recorder recordings into a speaker-labelled transcript you can play back in the browser.

- Merges each day's recordings (MP3 or WAV, mixed is fine) into one cleaned-up audio file.
- Transcribes with WhisperX (`large-v3`) and works out who spoke when, splitting lines wherever the speaker changes.
- Remembers voices across days, so `Speaker_2` today is the same person as `Speaker_2` last week. Rename them to real names once, and every past and future transcript uses the name.
- A browser app that opens on a home page:
  - **Sync** copies new recordings off the plugged-in recorder;
  - an activity grid shows which days you recorded;
  - transcription runs with live progress (automatically too, if you turn that on).

## Setup and run

You need **Python 3.12**, **ffmpeg** on your PATH, and ideally an NVIDIA GPU (it also runs on CPU, much more slowly).

```powershell
winget install Gyan.FFmpeg
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env      # then paste your Hugging Face token into .env
.venv\Scripts\python IngressScript\app.py
```

Open <http://localhost:5000> (it opens by itself). The first transcription downloads the models (a few GB, cached afterwards). The page is only reachable from this computer; add `--host 0.0.0.0` to allow other devices on your network.

If you use uv, run `uv pip install -r requirements.txt --index-strategy unsafe-best-match` so it picks the CUDA build of PyTorch.

Other commands:

```powershell
.venv\Scripts\python IngressScript\app.py --serve      # viewer only, nothing transcribed automatically
.venv\Scripts\python IngressScript\app.py --no-serve   # transcribe in the terminal, no viewer
.venv\Scripts\python IngressScript\app.py --no-serve --force --min-speakers 6   # redo everything, at least 6 people
.venv\Scripts\python IngressScript\app.py --speakers   # list known voices
.venv\Scripts\python IngressScript\app.py --rename Speaker_1 "Alice"
.venv\Scripts\python IngressScript\app.py --merge Speaker_3 "Alice"   # same person: fold Speaker_3 into Alice
```

**Hugging Face token:** create a read token at <https://huggingface.co/settings/tokens>. If it's a fine-grained token, tick "Read access to contents of all public gated repos". Then accept the terms on [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1).

## Recordings

Files must be named like the recorder names them: `V2026-08-20-06-18-54.MP3` or `.WAV`. Recordings shorter than 3 seconds are skipped. The recorder's `BIT:7` setting (1536 kbps WAV) works, and so does mixing it with older MP3s on the same day.

## Using the viewer

**Home** is where the app opens. Get back to it with *Home & sync* at the top of the library, or by clicking the app name.

1. **Set up (first run).** Check that everything shows green, then choose:
   - whether new recordings are **transcribed automatically** (off by default: nothing is transcribed until you say so);
   - the language;
   - the rustle cleanup.

   You can change these later under **Settings** at the bottom of Home.
2. **Sync.** Plug the recorder in. It's recognised by its `RECORD` folder and `SETTINGS.TXT`, whatever drive letter it gets. If it holds recordings that aren't in your library yet, a **Sync** card appears at the top of Home showing how many there are. Press **Sync** to copy them.
   - If auto-transcribe is on, the copied days start transcribing straight away; otherwise they wait for you to press Transcribe.
   - The card only appears when there is something new to copy.
   - `SYNC_MODE=copy` in `.env` (the default) leaves them on the recorder.
   - `SYNC_MODE=move` deletes each recording from the recorder once its copy has been checked.
3. **Recording activity.** A GitHub-style grid of the last year: one square per day, darker for more recordings, outlined in amber when not transcribed yet. Click a square to open that day.
4. **Transcription.** Shows what's running, with **Transcribe** buttons for days that are waiting.

### Recording levels

Every **Transcribe** or **Re-transcribe** opens a dialog with all of that day's recordings. Each one shows a waveform: grey is the original, blue is how it will sound with your settings, red marks clipping, amber marks clipping being repaired, and dimmed parts are silenced by the noise gate. Click a waveform to hear 10 seconds from that point exactly as transcription will hear it.

Each recording has its own controls:

- **Volume:** boost or lower it.
- **Speech sensitivity:** how quiet a voice can be and still get transcribed.
- **Noise gate:** silence everything below the dashed line.
- **Rustle cleanup:** for this recording only. Choose Off, Gentle, Strong or **Maximum**. Maximum also catches lighter rustle, cuts it harder, and turns the whole sound down during rustle with no speech in it; a quiet word said while rustling can get swallowed.
- **Repair clipping:** shown when a recording is clipped.

**Auto-adjust** (per recording, or **Auto-adjust all**) sets every control from the recording's measurements:
- volume, to bring quiet speech up to normal without clipping;
- sensitivity, from how far the speech sits above the background;
- a noise gate, if the background is clearly audible;
- rustle strength, from how much of the recording is rustle;
- repair clipping, if it's clipped.

Hover the button to see what was measured. Recordings set this way show an **Auto-adjusted** tag until you change something.

**Unusual recordings pause everything** unless auto-adjust can confidently fix them. A quiet recording that can be boosted cleanly is fixed automatically and transcription carries on. If a recording is very quiet, clipped or noisy, you haven't looked at it yet, and auto-adjust can't confidently fix it (for example, heavy clipping), the whole transcription queue stops. The dialog pops up on whatever page you're on, showing that recording with a suggested fix. Choose **Continue with these levels**, **Use as is** or **Skip this day**. This happens with auto-transcribe and **Transcribe all** too.

- **Library (left):** every day found in the recordings folder.
  - Days being transcribed show a live percentage, and a progress pill in the header follows the current job from any page.
  - Days that are new or incomplete (including recordings that are still being copied, which are picked up once the files stop changing) are queued automatically.
- **Transcript (middle):** click any line to play from there. Times are real clock times, and each separate recording gets a divider. Search with `/`.
- **Details (right):**
  - Day stats, and each recording (click to jump to it).
  - Who talked how much. Click a speaker to hide or show them; double-click to rename.
  - **Who is this voice?** Each speaker has a dropdown underneath, with the closest matches first (e.g. "Kenzie · 52% match"), or a one-click **Maybe Kenzie? 52%**.
    - Picking a name relabels every line by that voice on this day, and **teaches that person's voice profile**, so new days are tagged with their name automatically. Undo puts both back.
    - Other days' transcripts aren't rewritten.
  - **New voices** with at least 20 seconds of speech become a numbered "Speaker N" that will be recognised again; name them once. Tiny snippets stay "Unknown voice N".
  - **Talking over each other:** lines where someone else was talking at the same time get a small *talking over: X* tag, because some words may be missing or belong to the other person.
  - **Same person on every day?** Double-click a speaker and rename them to the other's name. That merges them everywhere and pools their voiceprints, so future recordings match better.
- **People** (in the library, under Home & sync): everyone named in your transcripts, with how many days and recordings they're in and how much they talked. Each person has their own GitHub-style grid of the days they were heard. Click a day to open it, or click a recording to jump straight to that person's first line in it.
  - **Wrong number of people?** Use **Re-transcribe this day…** and say how many were talking ("at least 6" works best when you're not sure). Names you've given are kept.
- **Editing lines:** hover a line and click the pencil. The line becomes a text box. Fix the words; change **who said it** (anyone the app knows, or *New person…*); **Split at cursor** to break it in two where the text cursor is; or **Join with next** to merge it with the following line. Enter saves, Esc cancels, and **Undo** appears for a few seconds. Edited lines get a small *edited* tag.
  - **Re-transcribing an edited day:** it warns you first, then replaces the edits. Days you've edited are never re-transcribed automatically (for example when new recordings arrive); you start that yourself.
- **Summary:** at the top of each day, press **Summarize this day**. Your local Ollama (`qwen3.5:35b-a3b`, set by `OLLAMA_MODEL` in `.env`) writes it, usually in under a minute for a short day and a few minutes for a long one. It contains:
  - an overview;
  - conversations;
  - a shopping list (things someone said you're out of);
  - project ideas, with their specifics;
  - to-dos;
  - key facts.

  Every point has a time chip that plays that moment, and shopping and to-do boxes can be ticked. If you edit the transcript afterwards, the summary says it's outdated, and you can press **Regenerate**.
- **Where files live:** each day has its own folder, `IngressScript/processed_daily/2026-10-02/`, containing `transcript.json`, `merged.wav`, `summary.json` and so on.
- **Removing lines:** hover a line and click the bin, or focus it and press **Del**. **Undo** appears for a few seconds. Removed lines stay removed even if the day is re-transcribed.
- **Clothing rustle:**
  - The scratchy sound of the mic rubbing on a shirt is turned down automatically before transcription and in playback. Voices aren't touched.
  - Lines that are probably just noise (Whisper "hearing" *"Thank you."* or *"so so"* in rustle) are hidden as **likely noise**. Show them with the button above the transcript, then **Trash all**, or click ✓ on any that are real.
  - Set `RUSTLE_STRENGTH=0` in `.env` to turn the suppression off, or `0.5` to soften it.
- Use ‹ › or **Shift+←/→** to move between days. Press `?` for the keyboard shortcuts.

## Tuning

These settings are at the top of `IngressScript/app.py`:

| Setting | Default | Effect |
|---|---|---|
| `RUSTLE_STRENGTH` (env) | 1.0 | Clothing-rustle suppression; 0 = off |
| `SAME_PERSON_THRESHOLD` | 0.75 | Clusters at least this similar are joined back into one person |
| `MATCH_THRESHOLD` | 0.68 | How similar a voice must be to a known person to be named automatically |
| `SUGGEST_THRESHOLD` | 0.45 | Weaker matches are offered as "Maybe …? 46%" suggestions instead |
| `MIN_VOICE_SECONDS` | 20 | Voices with less speech than this become "Unknown voice N" rather than a new person |
| `VAD_ONSET` / `VAD_OFFSET` | 0.35 / 0.25 | Lower values pick up quieter or more distant speech |

Set `LANGUAGE=en` in `.env` to skip language detection.
