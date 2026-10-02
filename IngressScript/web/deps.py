"""Request checks shared by the routers: valid dates and safe file names."""
from pathlib import Path

from fastapi import HTTPException

from core.config import DATE_RE, FILE_PATTERN, INPUT_DIR, RECORDING_SUFFIXES


def recording_path(name: str) -> Path:
    if not FILE_PATTERN.match(name):
        raise HTTPException(404, "Not a recording")
    return safe_file(INPUT_DIR, name, RECORDING_SUFFIXES)


def check_date(date: str):
    if not DATE_RE.match(date):
        raise HTTPException(404, "Unknown day")


def safe_file(folder: Path, name: str, suffixes: set[str]) -> Path:
    # Only serve plain filenames that live directly inside `folder`
    path = (folder / name).resolve()
    if path.parent != folder.resolve() or not path.is_file() or path.suffix.lower() not in suffixes:
        raise HTTPException(404, "File not found")
    return path
