"""Background threads that run one summary / extraction at a time."""
import time
import threading

from core.config import log
from core.paths import all_transcripts
from core.settings import setting
from llm.extract import extract_day
from llm.ollama import OLLAMA_MODEL, ollama_problems
from llm.summary import summarize_day, summary_path

class Extractor:
    """Fills in the Overview's data one day at a time, newest first, using the local model.
    Waits while transcription is running so the two don't fight over the GPU."""

    def __init__(self, busy=lambda: False):
        self.lock = threading.Lock()
        self.queue: list[str] = []
        self.current: dict | None = None     # {"date", "progress", "label"}
        self.errors: dict[str, str] = {}
        self.thread: threading.Thread | None = None
        self.busy = busy

    def state(self) -> dict:
        with self.lock:
            return {"current": dict(self.current) if self.current else None, "queued": list(self.queue),
                    "errors": dict(self.errors), "model": OLLAMA_MODEL}

    def enqueue(self, dates: list[str], retry: bool = False):
        with self.lock:
            for d in dates:
                if retry:
                    self.errors.pop(d, None)
                if d in self.queue or d in self.errors or (self.current and self.current["date"] == d):
                    continue
                self.queue.append(d)
            if self.queue and not (self.thread and self.thread.is_alive()):
                self.thread = threading.Thread(target=self._loop, daemon=True, name="overview-extract")
                self.thread.start()

    def _set(self, **kw):
        with self.lock:
            if self.current:
                self.current.update(kw)

    def _loop(self):
        while True:
            with self.lock:
                if not self.queue:
                    self.current = None
                    return
                date = self.queue.pop(0)
                self.current = {"date": date, "progress": 0.0, "label": "Waiting for transcription to finish"}
            while self.busy():
                time.sleep(10)
            try:
                with Summarizer._one_at_a_time:
                    self._set(label="Starting the model (first time takes about a minute)")
                    problems = ollama_problems()
                    if problems:
                        raise ConnectionError(" ".join(problems))
                    log(f"[overview] {date}: extracting with {OLLAMA_MODEL}")
                    extract_day(date, progress=lambda p, label: self._set(progress=p, label=label))
                log(f"[overview] {date}: done")
            except ConnectionError as e:
                # Ollama itself is the problem: stop here rather than failing every queued day
                with self.lock:
                    for d in [date] + self.queue:
                        self.errors[d] = str(e)
                    self.queue.clear()
            except Exception as e:
                log(f"[overview] {date} FAILED: {e}")
                with self.lock:
                    self.errors[date] = str(e)

class Summarizer:
    """Runs one summary at a time in the background so the viewer can show progress."""

    def __init__(self):
        self.lock = threading.Lock()
        self.jobs: dict[str, dict] = {}     # date -> {"status", "progress", "label", "error"}

    def state(self, date: str) -> dict:
        with self.lock:
            return dict(self.jobs.get(date, {}))

    def start(self, date: str):
        with self.lock:
            if self.jobs.get(date, {}).get("status") in ("queued", "running"):
                return
            self.jobs[date] = {"status": "queued", "progress": 0.0, "label": "Waiting"}
        threading.Thread(target=self._run, args=(date,), daemon=True, name=f"summary-{date}").start()

    _one_at_a_time = threading.Lock()

    def _set(self, date, **kw):
        with self.lock:
            self.jobs.setdefault(date, {}).update(kw)

    def _run(self, date: str):
        with self._one_at_a_time:
            self._set(date, status="running", label="Starting the model (first time takes about a minute)")
            try:
                problems = ollama_problems()
                if problems:
                    raise RuntimeError(" ".join(problems))
                log(f"[summary] {date}: summarising with {OLLAMA_MODEL}")
                summarize_day(date, progress=lambda p, label: self._set(date, progress=p, label=label))
                self._set(date, status="done")
                log(f"[summary] {date}: done")
            except Exception as e:
                log(f"[summary] {date} FAILED: {e}")
                self._set(date, status="failed", error=str(e))

    def watch(self, interval: int = 300):
        """Periodically checks for days that need summarizing and runs them."""
        def _watch():
            while True:
                if setting("auto_summarize") and not self._one_at_a_time.locked():
                    # Find days that have a transcript but no summary (or an outdated one)
                    for date in all_transcripts():
                        if not summary_path(date).is_file():
                            self.start(date)
                            break # Summarize one by one
                    # If all days are summarized, we could potentially trigger a global overview here
                    # But global overview is usually a separate manual action or a final step.
                time.sleep(interval)
        threading.Thread(target=_watch, daemon=True, name="summary-watch").start()
