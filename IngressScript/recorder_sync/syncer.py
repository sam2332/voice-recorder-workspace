"""Copies (or moves) new recordings off a recorder into RECORD_DIR, with progress."""
import time
import shutil
import threading
from pathlib import Path

from core.config import FILE_PATTERN, INPUT_DIR, log
from core.settings import setting
from recorder_sync.recorders import _child, find_recorders, SYNC_MODE

class Syncer:
    """Copies new recordings from the recorder into RECORD_DIR in the background, with progress."""

    def __init__(self, on_done=None):
        self.lock = threading.Lock()
        self.state: dict = {"running": False}
        self.on_done = on_done   # called with the dates that received new recordings

    def watch(self, interval: int = 60):
        """Periodically checks for new recordings and starts sync if auto_sync is on."""
        def _watch():
            while True:
                if setting("auto_sync") and not self.state.get("running"):
                    recorders = find_recorders()
                    for r in recorders:
                        if r["new"] > 0:
                            try:
                                self.start(r["root"])
                                break
                            except Exception as e:
                                log(f"[sync-watch] failed to start: {e}")
                time.sleep(interval)
        threading.Thread(target=_watch, daemon=True, name="recorder-sync-watch").start()

    def status(self) -> dict:
        with self.lock:
            return dict(self.state)

    def start(self, root: str) -> dict:
        with self.lock:
            if self.state.get("running"):
                return dict(self.state)
            match = next((r for r in find_recorders() if r["root"] == root), None)
            if not match:
                raise FileNotFoundError("The recorder isn't connected any more.")
            self.state = {"running": True, "root": root, "label": match["label"], "mode": SYNC_MODE,
                          "files_done": 0, "files_total": match["new"], "bytes_done": 0,
                          "bytes_total": match["new_bytes"], "current": None, "error": None,
                          "copied": [], "days": match["days"], "started": time.time()}
        threading.Thread(target=self._run, args=(Path(root),), daemon=True, name="recorder-sync").start()
        return self.status()

    def _set(self, **kw):
        with self.lock:
            self.state.update(kw)

    def _run(self, root: Path):
        try:
            rec = _child(root, "RECORD")
            INPUT_DIR.mkdir(parents=True, exist_ok=True)
            for src in sorted(f for f in rec.iterdir() if f.is_file() and FILE_PATTERN.match(f.name)):
                dst = INPUT_DIR / src.name
                size = src.stat().st_size
                if dst.exists() and dst.stat().st_size == size:
                    if SYNC_MODE == "move":
                        src.unlink()   # already safely in the library
                    continue
                self._set(current=src.name)
                part = dst.with_name(dst.name + ".part")
                with open(src, "rb") as fi, open(part, "wb") as fo:
                    while chunk := fi.read(4 << 20):
                        fo.write(chunk)
                        with self.lock:
                            self.state["bytes_done"] += len(chunk)
                shutil.copystat(src, part)   # keep the recording's own timestamp
                if part.stat().st_size != size:
                    raise IOError(f"Copy of {src.name} came out the wrong size; the recorder copy was kept.")
                part.replace(dst)
                if SYNC_MODE == "move":
                    src.unlink()
                with self.lock:
                    self.state["files_done"] += 1
                    self.state["copied"].append(src.name)
            log(f"[sync] {'Moved' if SYNC_MODE == 'move' else 'Copied'} {self.state['files_done']} recording(s) from {root}")
            days = sorted({FILE_PATTERN.match(n).group(1) for n in self.state["copied"]})
            if days and self.on_done:
                self.on_done(days)
        except Exception as e:
            log(f"[sync] failed: {e}")
            self._set(error=str(e))
            for p in INPUT_DIR.glob("*.part"):
                p.unlink(missing_ok=True)
        finally:
            self._set(running=False, current=None, finished=time.time())
