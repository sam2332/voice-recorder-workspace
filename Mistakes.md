# Mistakes I made on this project, and the rules to avoid repeating them

Written by Claude after building most of this app with Lily. Every item below really happened.

## Working with you

1. **I didn't ask questions before building.** The first versions were based on my own assumptions: the app opened straight into a transcript, and auto-transcribe ran before you'd set anything up. You had to tell me to ask clarifying questions.
   **Rule:** before any feature with real choices in it, ask 2–4 short questions (what, when, how far it reaches, what happens on undo or re-run), then build.

2. **I kept working through long turns without checking in.** You assumed I was done and started moving files and editing `app.py` yourself while I was still changing it.
   **Rule:** finish one request, summarise it, then start the next. When new requests arrive mid-turn, say which one I'm on and what's queued.

3. **I treated "tested on a synthetic clip" as "it works".** Your real Oct 2 day (a quiet stretch, then a phone call) showed problems none of my test clips did: Norwegian hallucinations, six fake speakers, and the 1:58 player bug.
   **Rule:** test every audio-pipeline change on real recordings (copies, in scratch folders) before calling it done.

4. **I built Docker without first checking it could do what you needed.** Docker Desktop can't see USB drives, so Sync was impossible there. The image is ~20 GB and is still on disk.
   **Rule:** prove the hard requirement first (here, "can the container see the recorder?"), then build around it.

## Touching your data

5. **I wrote to your real voice database during a test.** A rename test changed `Speaker_1` to "Alice" in `speaker_memory.db` while your transcript still said `Speaker_1`.
   **Rule:** every test sets `RECORD_DIR`, `OUTPUT_DIR`, `SPEAKER_DB` and `SETTINGS_PATH` to scratch copies. Never run the server or the pipeline against the real folders.

6. **I deleted a file that git was tracking** (`.claude/launch.json`) without checking `git status` first. I restored it.
   **Rule:** check `git status` / `git ls-files` before deleting anything in the repo.

7. **I printed your Hugging Face token into a log** (by dumping the pipeline's parameters). I deleted the log.
   **Rule:** never print config objects, environment variables or request parameters wholesale; print only the fields needed.

8. **I left a stray test server running** (`python -m http.server 8765`).
   **Rule:** stop every background process I start, and list running python processes before finishing.

## Code mistakes

9. **I edited code through Bash heredocs and Python string literals, which corrupted escapes several times.** `\n` became a real line break, and Windows paths and regex backslashes broke (`\U`, `\S`, `\\n`).
   **Rule:** use the Edit tool for any line containing escapes, or put a patch script in a file and run it. Run `py_compile` after every Python change.

10. **SQLite connection shared across threads.** The background worker reused a connection created on another thread ("SQLite objects created in a thread can only be used in that same thread").
    **Rule:** open SQLite connections where they're used and close them; never keep one on a long-lived object.

11. **Browser caching of rebuilt files.** The audio URL stayed the same when a day was rebuilt, so the browser kept playing the old 1:58 file.
    **Rule:** any file that can be regenerated gets a version in its URL (`?v=<mtime>`) and `Cache-Control: no-cache`.

12. **Viewer bugs I shipped and only caught later:**
    - a CSS class name collision (`.pending` on both a card and a chip);
    - Home redrawing every 5 s, which wiped form edits and swallowed clicks;
    - the speaker picker built before the names had loaded;
    - People cards overflowing sideways;
    - Markdown headings one level off.

    **Rule:** after a UI change, check it in the browser at desktop and narrow widths, including what happens on the next poll and after async loads.

13. **The language was guessed from the first 30 s,** and whisperx silently reused the first day's language for later days.
    **Rule:** don't trust library defaults on long, quiet recordings. Default to the user's language (English) and reset per-run state.

14. **A size threshold measured in bytes** (500 KB) meant ~2 minutes for MP3 but under 3 seconds for WAV.
    **Rule:** express thresholds in the unit that matters (seconds of audio), not one that depends on the format.

15. **A matching threshold set too loose (0.55),** which produced false cross-day matches. Short noise clusters were also enrolled as "new people".
    **Rule:** calibrate thresholds on real data, and don't create permanent records from too little evidence.

16. **I measured rustle cleanup on audio that had already been cleaned,** so the first comparison was meaningless.
    **Rule:** check which version of the data a measurement runs on before trusting the numbers.

17. **The first local-model (Ollama) call had no output cap and no streaming.** It ran away for 10+ minutes on a short day.
    **Rule:** cap output (`num_predict`), stream so progress is visible, and test with a timeout.

18. **The summary prompt had gaps:**
    - the model cited ranges (`[L30-L45]`) that the renderer didn't handle;
    - it wrote "No items mentioned" sections even though I'd asked it to leave them out.

    **Rule:** validate model output against the format and clean it up in code; don't rely on the prompt alone.
