# Voice Recorder Transcripts

Turns a day's worth of voice-recorder recordings into a speaker-labelled transcript you can play back in the browser.

- Merges each day's recordings (MP3 or WAV, mixed is fine) into one cleaned-up audio file.
- Transcribes with WhisperX (`large-v3`) and works out who spoke when, splitting lines wherever the speaker changes.
- Remembers voices across days, so `Speaker_2` today is the same person as `Speaker_2` last week. Rename them to real names once, and every past and future transcript uses the name.
- A browser viewer comes up immediately. New or incomplete days are transcribed in the background, with live progress on the page.

## Run with Docker (recommended)

You need Docker Desktop with an NVIDIA GPU (WSL2 backend on Windows).

```powershell
copy .env.example .env      # paste your Hugging Face token into .env
docker compose up -d --build
```

Open <http://localhost:5000>. The first build downloads about 8 GB, and the first transcription downloads the models (a few GB, cached afterwards). Follow along with `docker compose logs -f`; stop with `docker compose down`.

- **Recordings:** read from `./RECORD`. To read straight from the recorder, set `RECORD_PATH=E:/RECORD` in `.env`.
- **Your data:** transcripts and the voice database are stored in `IngressScript/`, the same files a local run uses.
- **Access:** the page is only reachable from this computer. To allow other devices, change the port line in `docker-compose.yml` to `"5000:5000"`.

## Run locally

You need **Python 3.12**, **ffmpeg** on your PATH, and ideally an NVIDIA GPU (it also runs on CPU, much more slowly).

```powershell
winget install Gyan.FFmpeg
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env      # then paste your Hugging Face token into .env
.venv\Scripts\python IngressScript\app.py
```

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

- **Library (left):** every day found in the recordings folder.
  - Days being transcribed show a live percentage, and a progress pill in the header follows the current job from any page.
  - Days that are new or incomplete (including recordings that are still being copied, which are picked up once the files stop changing) are queued automatically.
- **Transcript (middle):** click any line to play from there. Times are real clock times, and each separate recording gets a divider. Search with `/`.
- **Details (right):**
  - Day stats, and each recording (click to jump to it).
  - Who talked how much. Click a speaker to hide or show them; double-click to rename.
  - **Same person listed twice?** Rename one to the other's name and confirm the merge. Their lines on every day join up, and their voiceprints are pooled so future recordings match better.
  - **Wrong number of people?** Use **Re-transcribe this day…** and say how many were talking ("at least 6" works best when you're not sure). Names you've given are kept.
- Use ‹ › or **Shift+←/→** to move between days. Press `?` for the keyboard shortcuts.

## Tuning

These settings are at the top of `IngressScript/app.py`:

| Setting | Default | Effect |
|---|---|---|
| `CLUSTER_THRESHOLD` | see file | Lower values split voices more eagerly (more sensitive) |
| `SAME_PERSON_THRESHOLD` | 0.75 | Clusters at least this similar are joined back into one person |
| `MATCH_THRESHOLD` | 0.55 | How similar a voice must be to a known person to reuse their name |
| `VAD_ONSET` / `VAD_OFFSET` | 0.35 / 0.25 | Lower values pick up quieter or more distant speech |

Set `LANGUAGE=en` in `.env` to skip language detection.
