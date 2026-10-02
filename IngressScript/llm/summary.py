"""Day summaries: prompt, chunking, citations and summary.json."""
import re
import json
import time
from pathlib import Path

from core.paths import day_dir, transcript_path
from llm.markdown import drop_empty_sections
from llm.ollama import ollama_chat, OLLAMA_MODEL
from transcripts.store import load_transcript

SUMMARY_CHUNK_CHARS = 20000        # transcript text per model call; long days are read in parts

SUMMARY_CONTEXT = """You are summarising one day of audio from a personal voice recorder that its owner wears all day.
It picks up the owner, their roommates and anyone else nearby. Typical content:
- things someone says out loud that the household is out of or needs to buy,
- project ideas, usually with specifics (materials, sizes, steps, tools, costs),
- general chat with roommates, phone calls and meetings.
Transcript lines look like: [L12] 9:43 AM Speaker 2: text
The [L12] tag identifies the line. Speaker names are as written (some are placeholders like "Speaker 2").
The transcript comes from automatic speech recognition, so expect some mistakes; don't invent facts to fill gaps.
Only use what is in the transcript. Write in English."""

SUMMARY_FORMAT = """Write the summary in Markdown using exactly these sections, in this order. Leave out any section
that would be empty. Put the [L..] tag of the line(s) it came from at the end of every bullet.

## Overview
Two to four sentences on what the day was about.

## Conversations
- **Short title**: who was involved; one-line gist [L12]
  - a key point [L15]

## Shopping list
- [ ] item (who mentioned it, and why if said) [L40]

## Project ideas
### Idea name
- a specific detail that was mentioned [L50]
(Project ideas are things the owner or their roommates want to make, build, start or try. Work being
explained or discussed, like how a system at work functions, belongs under Conversations, not here.)

## To-dos
- [ ] task (who) [L60]

## Decisions & key facts
- fact, number, name or date worth remembering [L70]

Rules: no preamble or closing remarks; refer to people by the names in the transcript; skip filler and small talk
that has no content; never cite a [L..] tag that isn't in the transcript."""

def clock_label(sources: list[dict], t: float) -> str:
    """Wall-clock time (e.g. '9:43 AM') of a moment in the merged day audio."""
    src = next((s for s in reversed(sources) if isinstance(s, dict) and s.get("start", 0) <= t + 0.01), None)
    if not src or not src.get("recorded_at"):
        return f"{int(t // 60)}:{int(t % 60):02d}"
    h, m, s = (int(x) for x in src["recorded_at"].split(":"))
    secs = h * 3600 + m * 60 + s + int(t - src["start"])
    h, m = (secs // 3600) % 24, (secs // 60) % 60
    return f"{(h % 12) or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"

def summary_path(date: str) -> Path:
    return day_dir(date) / "summary.json"

def transcript_fingerprint(data: dict) -> str:
    """Changes whenever the words or speakers that a summary is based on change."""
    import hashlib
    body = [(s.get("speaker"), s.get("text")) for s in data.get("segments", []) if not s.get("noise")]
    return hashlib.sha1(json.dumps(body, ensure_ascii=False).encode("utf-8")).hexdigest()

def summarize_day(date: str, progress=None) -> dict:
    """Summarise a day's transcript with the local model. Long days are read in parts (notes per part),
    then the notes are turned into the final summary."""
    path = transcript_path(date)
    data = load_transcript(path)
    sources = data.get("sources", [])
    lines, refs = [], {}
    for i, s in enumerate(data.get("segments", [])):
        if s.get("noise") or not s.get("text", "").strip():
            continue
        ref = f"L{i + 1}"
        refs[ref] = s["start"]
        lines.append(f"[{ref}] {clock_label(sources, s['start'])} {s.get('speaker', 'Unknown').replace('_', ' ')}: {s['text']}")
    if not lines:
        raise RuntimeError("There's no speech in this day's transcript to summarise.")

    parts, cur = [], []
    for line in lines:
        if cur and sum(len(l) + 1 for l in cur) + len(line) > SUMMARY_CHUNK_CHARS:
            parts.append(cur)
            cur = []
        cur.append(line)
    parts.append(cur)

    day = toDate_label(date)
    if len(parts) == 1:
        if progress:
            progress(0.1, "Writing the summary")
        md = ollama_chat(f"Transcript for {day}:\n\n" + "\n".join(parts[0]) + "\n\n" + SUMMARY_FORMAT, SUMMARY_CONTEXT,
                         on_token=lambda k: progress and progress(min(0.95, 0.1 + k / 1500), f"Writing the summary ({k} words so far)"))
    else:
        notes = []
        for n, part in enumerate(parts, 1):
            if progress:
                progress((n - 1) / (len(parts) + 1), f"Reading part {n} of {len(parts)}" if len(parts) > 1 else "Reading the day")
            notes.append(ollama_chat(
                f"Part {n} of {len(parts)} of the transcript for {day}:\n\n" + "\n".join(part) +
                "\n\nWrite compact bullet-point notes on this part only: each conversation (topic, who), anything someone "
                "said they're out of or need to buy, project ideas with every specific mentioned, to-dos, decisions and "
                "key facts. End every bullet with the [L..] tag(s) it came from, copied exactly. No preamble.",
                SUMMARY_CONTEXT, max_tokens=900,
                on_token=lambda k, n=n: progress and progress((n - 1 + min(0.95, k / 900)) / (len(parts) + 1),
                                                              f"Reading part {n} of {len(parts)} ({k} words of notes)")))
        if progress:
            progress(len(parts) / (len(parts) + 1), "Writing the summary")
        md = ollama_chat(
            f"Notes on the transcript for {day}, part by part in time order:\n\n" +
            "\n\n".join(f"### Part {n}\n{t}" for n, t in enumerate(notes, 1)) +
            "\n\nCombine these notes into one summary of the whole day (merge duplicates; keep the [L..] tags).\n\n" + SUMMARY_FORMAT,
            SUMMARY_CONTEXT, max_tokens=2000,
            on_token=lambda k: progress and progress((len(parts) + min(0.95, k / 2000)) / (len(parts) + 1),
                                                     f"Writing the summary ({k} words so far)"))
    md = drop_empty_sections(md)
    # Tags can be single lines, lists or ranges: [L12], [L12, L15], [L30-L45]
    used = {f"L{n}" for tag in re.findall(r"\[(L\d+(?:\s*[-\u2013,]\s*L?\d+)*)\]", md) for n in re.findall(r"\d+", tag)}
    result = {"markdown": md, "model": OLLAMA_MODEL, "created": time.time(), "fingerprint": transcript_fingerprint(data),
              "refs": {r: refs[r] for r in used if r in refs}, "parts": len(parts)}
    tmp = summary_path(date).with_suffix(".tmp")
    tmp.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(summary_path(date))
    return result

def toDate_label(date: str) -> str:
    from datetime import date as _d
    try:
        return _d.fromisoformat(date).strftime("%A, %B %d, %Y")
    except ValueError:
        return date
