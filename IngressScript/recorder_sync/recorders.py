"""Finding voice recorders plugged into this PC (a RECORD folder + SETTINGS.TXT at the root)."""
import os
import re
import sys
from pathlib import Path

from core.config import FILE_PATTERN, INPUT_DIR

# Copy (or move) recordings off the voice recorder when it's plugged in. SYNC_MODE=move deletes
# each file from the recorder once its copy has been verified.
SYNC_MODE = "move" if os.getenv("SYNC_MODE", "copy").strip().lower() == "move" else "copy"

# Extra folders to look for a recorder in (separated by ; or ,), besides the drives found automatically
SYNC_SOURCES = [p.strip() for p in re.split(r"[;,]", os.getenv("SYNC_SOURCES", "")) if p.strip()]

RECORDER_QUALITY = {"1": "32 kbps MP3", "2": "64 kbps MP3", "3": "128 kbps MP3", "4": "256 kbps WAV",
                    "5": "512 kbps WAV", "6": "768 kbps WAV", "7": "1536 kbps WAV"}

def _candidate_roots() -> list[Path]:
    roots = [Path(p) for p in SYNC_SOURCES]
    if sys.platform == "win32":
        import ctypes
        k32 = ctypes.windll.kernel32
        mask = k32.GetLogicalDrives()
        for i in range(26):
            if mask & (1 << i):
                root = f"{chr(65 + i)}:\\"
                # 2 = removable, 3 = fixed. Network and optical drives are skipped (slow / never a recorder).
                if k32.GetDriveTypeW(ctypes.c_wchar_p(root)) in (2, 3):
                    roots.append(Path(root))
    else:
        for pattern in ("/media/*", "/media/*/*", "/mnt/*", "/run/media/*/*", "/Volumes/*"):
            roots += [Path(p) for p in __import__("glob").glob(pattern)]
    return roots

def _volume_label(root: Path) -> str:
    if sys.platform == "win32":
        import ctypes
        buf = ctypes.create_unicode_buffer(261)
        if ctypes.windll.kernel32.GetVolumeInformationW(ctypes.c_wchar_p(str(root)), buf, 261,
                                                        None, None, None, None, 0):
            return f"{buf.value or 'Drive'} ({str(root).rstrip(chr(92))})"
    return root.name or str(root)

def _child(folder: Path, name: str) -> Path | None:
    """Case-insensitive child lookup (FAT drives and Linux mounts differ in case)."""
    try:
        return next((p for p in folder.iterdir() if p.name.lower() == name.lower()), None)
    except OSError:
        return None

def find_recorders() -> list[dict]:
    """Drives that look like the voice recorder: a RECORD folder next to SETTINGS.TXT."""
    found, seen = [], set()
    local = INPUT_DIR.resolve() if INPUT_DIR.exists() else INPUT_DIR
    for root in _candidate_roots():
        try:
            rec, cfg = _child(root, "RECORD"), _child(root, "SETTINGS.TXT")
            if not rec or not rec.is_dir() or not cfg or rec.resolve() == local or str(rec.resolve()) in seen:
                continue
            seen.add(str(rec.resolve()))
            files = sorted(f for f in rec.iterdir() if f.is_file() and FILE_PATTERN.match(f.name))
            new = [f for f in files if not ((INPUT_DIR / f.name).exists()
                                            and (INPUT_DIR / f.name).stat().st_size == f.stat().st_size)]
            quality = re.search(r"^BIT:(\d)", cfg.read_text(encoding="utf-8", errors="ignore"), re.M)
            found.append({
                "root": str(root), "label": _volume_label(root), "total": len(files),
                "new": len(new), "new_bytes": sum(f.stat().st_size for f in new),
                "days": sorted({FILE_PATTERN.match(f.name).group(1) for f in new}),
                "quality": RECORDER_QUALITY.get(quality.group(1)) if quality else None,
            })
        except OSError:
            continue
    return found
