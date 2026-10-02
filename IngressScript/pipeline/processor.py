"""Processor: the server's single background worker thread and queue."""
import time
import threading

from audio.analysis import flagged_clips
from audio.files import get_daily_batches
from audio.segments import day_segments
from core.config import INPUT_DIR, log, OUTPUT_DIR
from core.settings import setting
from pipeline.batch import needs_processing
from pipeline.checks import model_access_problems, setup_problems
from pipeline.engine import Engine
from transcripts.store import has_edits

class Processor:
    """Single worker thread that transcribes days queued from the viewer, one at a time."""

    def __init__(self):
        self.lock = threading.Lock()
        self.queue: list[str] = []
        self.hints: dict[str, dict | None] = {}
        self.current: dict | None = None    # {"date", "progress", "label", "started"}
        self.errors: dict[str, str] = {}
        self.engine: Engine | None = None
        self.thread: threading.Thread | None = None
        self.failed_state: dict[str, tuple] = {}   # date -> recordings snapshot when it failed
        self.blocked: dict | None = None            # {"date", "clips"}: waiting for the user to check levels
        self.unblock = threading.Event()

    def resolve(self, action: str):
        """The user dealt with a flagged clip: 'continue' (levels saved / accepted) or 'skip' the day."""
        with self.lock:
            if not self.blocked:
                return
            if action == "skip" and self.blocked["date"] in self.queue:
                self.queue.remove(self.blocked["date"])
            self.blocked = None
        self.unblock.set()

    def summary(self) -> dict:
        with self.lock:
            cur = self.current and {k: self.current[k] for k in ("date", "progress", "label")}
            return {"current": cur, "queued": list(self.queue), "blocked": self.blocked}

    def watch(self, interval: float = 30.0, settle: float = 60.0, force: bool = False):
        """Keep an eye on the recordings folder and queue any day that is new or incomplete.
        Days whose files changed in the last `settle` seconds are left alone (still copying)."""
        def snapshot(files):
            return tuple((f.name, f.stat().st_size) for f in files)

        def loop():
            first = True
            while True:
                try:
                    if not setting("auto_transcribe"):   # off until the user turns it on in setup/settings
                        time.sleep(5)
                        continue
                    now = time.time()
                    for date, files in sorted(get_daily_batches(INPUT_DIR).items()):
                        if any(now - f.stat().st_mtime < settle for f in files):
                            continue
                        # A day that failed is retried only once its recordings change (or from the UI)
                        if self.failed_state.get(date) == snapshot(files):
                            continue
                        if (first and force) or needs_processing(date, files):
                            # Never silently overwrite hand-edited lines: those days wait for a manual
                            # Re-transcribe, which warns first
                            if has_edits(date):
                                continue
                            self.enqueue(date)
                except Exception as e:
                    log(f"(watcher: {e})")
                first = False
                time.sleep(interval)

        threading.Thread(target=loop, daemon=True, name="record-watcher").start()

    def enqueue(self, date: str, hint: dict | None = None):
        with self.lock:
            if date in self.queue or (self.current and self.current["date"] == date):
                return
            self.errors.pop(date, None)
            self.failed_state.pop(date, None)
            self.hints[date] = hint
            self.queue.append(date)
            if not self.thread or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._run, daemon=True)
                self.thread.start()

    def cancel(self, date: str) -> bool:
        with self.lock:
            if date in self.queue:
                self.queue.remove(date)
                return True
        return False

    def state_for(self, date: str) -> dict | None:
        with self.lock:
            if self.blocked and self.blocked["date"] == date:
                return {"status": "blocked", "clips": self.blocked["clips"]}
            if self.current and self.current["date"] == date:
                return {"status": "processing", "progress": round(self.current["progress"], 3),
                        "label": self.current["label"]}
            if date in self.queue:
                return {"status": "queued", "position": self.queue.index(date) + 1}
            if date in self.errors:
                return {"status": "failed", "error": self.errors[date]}
        return None

    def _set(self, **kw):
        with self.lock:
            if self.current:
                self.current.update(kw)

    def _run(self):
        while True:
            with self.lock:
                if not self.queue:
                    self.current = None
                    return
                date = self.queue.pop(0)
                hint = self.hints.pop(date, None)
                self.current = {"date": date, "progress": 0.0, "label": "Starting", "started": time.time()}
            try:
                problems = setup_problems()
                if not problems and self.engine is None:
                    self._set(label="Checking model access")
                    problems = model_access_problems()
                if problems:
                    raise RuntimeError(" ".join(problems))
                files = get_daily_batches(INPUT_DIR).get(date)
                if not files:
                    raise RuntimeError(f"No recordings for {date} in {INPUT_DIR}")
                OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                # A recording that's very quiet / clipped / noisy and hasn't been looked at stops the whole
                # queue until the user sets its levels in the viewer (or accepts it as is, or skips the day)
                self._set(label="Finding speech and checking audio levels")
                flagged = flagged_clips(day_segments(date, files), autofix=True)
                if flagged:
                    log(f"[viewer] {date}: waiting for levels on {', '.join(flagged)}")
                    with self.lock:
                        self.blocked = {"date": date, "clips": flagged}
                        self.queue.insert(0, date)
                        self.hints[date] = hint
                        self.current = None
                    self.unblock.clear()
                    self.unblock.wait()
                    continue
                if self.engine is None:
                    self._set(label="Loading models (first time can take several minutes)")
                    self.engine = Engine()
                log(f"\n[viewer] Processing {date} - {len(files)} recording(s)")
                self.engine.process_day(date, files, hint=hint,
                                        progress=lambda p, label: self._set(progress=p, label=label))
            except Exception as e:
                log(f"  FAILED: {e}")
                with self.lock:
                    self.errors[date] = str(e)
                    files = get_daily_batches(INPUT_DIR).get(date, [])
                    self.failed_state[date] = tuple((f.name, f.stat().st_size) for f in files)
