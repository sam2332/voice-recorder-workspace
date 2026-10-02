"""Status summaries of a meeting (local Ollama)."""
import re
import time

from core.config import log
from llm.markdown import drop_empty_sections
from llm.ollama import ollama_chat, OLLAMA_MODEL, ollama_problems
from llm.summary import SUMMARY_CHUNK_CHARS
from llm.workers import Summarizer
from meetings.store import get_meeting, meeting_fingerprint, meeting_lines, update_meetings

MEETING_CONTEXT = """You are summarising a meeting (or a group of related conversations) from a personal voice recorder.
Transcript lines look like: [L12] 2026-10-02 9:43 AM Speaker 2: text
The [L12] tag identifies the line. Speaker names are as written (some are placeholders like "Speaker 2").
The transcript comes from automatic speech recognition, so expect some mistakes; don't invent facts to fill gaps.
Only use what is in the transcript. Write in English."""

MEETING_FORMAT = """Write a status summary of the meeting in Markdown using exactly these sections, in this order. Leave out any
section that would be empty. Put the [L..] tag of the line(s) it came from at the end of every bullet.

## Overview
Two to four sentences: what the meeting was about and who took part.

## Where things stand
- topic or workstream: its status now (done, in progress, blocked, not started) and what happens next [L12]

## Decisions
- what was decided, and by whom [L20]

## Action items
- [ ] task (owner, due date if said) [L30]

## Open questions & risks
- unresolved question, blocker or concern [L40]

Rules: no preamble or closing remarks; refer to people by the names in the transcript; never cite a [L..] tag that
isn't in the transcript."""

def summarize_meeting(mid: str, progress=None) -> dict:
    m = get_meeting(mid)
    if m is None:
        raise RuntimeError("That meeting no longer exists.")
    marked, _ = meeting_lines(m)
    if not marked:
        raise RuntimeError("Add some lines to this meeting first.")
    lines, refs = [], {}
    for i, l in enumerate(marked, 1):
        refs[f"L{i}"] = {"date": l["date"], "start": l["start"], "at": l["at"]}
        lines.append(f"[L{i}] {l['date']} {l['at']} {l['speaker'].replace('_', ' ')}: {l['text']}")
    parts, cur = [], []
    for line in lines:
        if cur and sum(len(x) + 1 for x in cur) + len(line) > SUMMARY_CHUNK_CHARS:
            parts.append(cur)
            cur = []
        cur.append(line)
    parts.append(cur)
    head = f"Meeting \"{m['name']}\""
    if len(parts) == 1:
        if progress:
            progress(0.1, "Writing the summary")
        md = ollama_chat(f"{head}:\n\n" + "\n".join(parts[0]) + "\n\n" + MEETING_FORMAT, MEETING_CONTEXT,
                         on_token=lambda k: progress and progress(min(0.95, 0.1 + k / 1500), f"Writing the summary ({k} words so far)"))
    else:
        notes = []
        for n, part in enumerate(parts, 1):
            if progress:
                progress((n - 1) / (len(parts) + 1), f"Reading part {n} of {len(parts)}")
            notes.append(ollama_chat(
                f"Part {n} of {len(parts)} of {head}:\n\n" + "\n".join(part) +
                "\n\nWrite compact bullet-point notes on this part only: what each topic's status is, decisions, action items "
                "with owners, open questions. End every bullet with the [L..] tag(s) it came from, copied exactly. No preamble.",
                MEETING_CONTEXT, max_tokens=900))
        if progress:
            progress(len(parts) / (len(parts) + 1), "Writing the summary")
        md = ollama_chat(f"Notes on {head}, part by part in time order:\n\n" +
                         "\n\n".join(f"### Part {n}\n{t}" for n, t in enumerate(notes, 1)) +
                         "\n\nCombine these notes into one summary of the whole meeting (merge duplicates; keep the [L..] tags).\n\n" + MEETING_FORMAT,
                         MEETING_CONTEXT, max_tokens=2000)
    md = drop_empty_sections(md)
    used = {f"L{n}" for tag in re.findall(r"\[(L\d+(?:\s*[-\u2013,]\s*L?\d+)*)\]", md) for n in re.findall(r"\d+", tag)}
    result = {"markdown": md, "model": OLLAMA_MODEL, "created": time.time(), "fingerprint": meeting_fingerprint(marked),
              "refs": {r: refs[r] for r in used if r in refs}}

    def save(meetings):
        for x in meetings:
            if x["id"] == mid:
                x["summary"] = result
    update_meetings(save)
    return result

class MeetingSummarizer(Summarizer):
    """Same one-at-a-time background runner as day summaries (they share the model lock); keyed by meeting id."""

    def _run(self, mid: str):
        with self._one_at_a_time:
            self._set(mid, status="running", label="Starting the model (first time takes about a minute)")
            try:
                problems = ollama_problems()
                if problems:
                    raise RuntimeError(" ".join(problems))
                log(f"[meeting] {mid}: summarising with {OLLAMA_MODEL}")
                summarize_meeting(mid, progress=lambda p, label: self._set(mid, progress=p, label=label))
                self._set(mid, status="done")
            except Exception as e:
                log(f"[meeting] {mid} FAILED: {e}")
                self._set(mid, status="failed", error=str(e))
