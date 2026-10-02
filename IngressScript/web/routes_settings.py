"""Settings, setup checks and recorder sync."""
import time
import shutil
import subprocess

from fastapi import APIRouter, HTTPException

from app_config import HF_TOKEN
from core.config import INPUT_DIR, log
from core.settings import load_settings, save_settings
from pipeline.checks import model_access_problems, setup_problems
from recorder_sync.recorders import find_recorders, SYNC_MODE
from web.models import SettingsBody, SyncBody


def build(ctx) -> APIRouter:
    router = APIRouter()
    syncer = ctx.syncer
    checks_cache: dict = {}

    def system_checks(fresh: bool = False) -> dict:
        """What setup needs: HF access, ffmpeg, GPU, recordings folder. Cached (the HF check is a web call)."""
        if fresh or time.time() - checks_cache.get("at", 0) > 600:
            problems = setup_problems()
            hf = [p for p in problems if "HF_TOKEN" in p] or (model_access_problems() if HF_TOKEN else [])
            gpu = None
            if shutil.which("nvidia-smi"):
                out = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                                     capture_output=True, text=True)
                gpu = out.stdout.strip().splitlines()[0] if out.returncode == 0 and out.stdout.strip() else None
            checks_cache.update(at=time.time(), checks={
                "hf": {"ok": not hf, "detail": " ".join(hf) or "Hugging Face models are accessible."},
                "ffmpeg": {"ok": shutil.which("ffmpeg") is not None,
                           "detail": "ffmpeg found." if shutil.which("ffmpeg") else "ffmpeg is not installed / not on PATH."},
                "gpu": {"ok": gpu is not None,
                        "detail": gpu or "No NVIDIA GPU found: transcription will run on the CPU (much slower)."},
                "record_dir": {"ok": INPUT_DIR.is_dir(), "detail": str(INPUT_DIR)},
            })
        return checks_cache["checks"]

    @router.get("/api/settings")
    def get_settings(fresh: bool = False):
        return {"settings": load_settings(), "checks": system_checks(fresh), "sync_mode": SYNC_MODE}

    @router.post("/api/settings")
    def put_settings(body: SettingsBody):
        saved = save_settings(body.model_dump(exclude_none=True))
        log(f"Settings saved: auto-transcribe {'on' if saved['auto_transcribe'] else 'off'}, "
            f"auto-sync {'on' if saved['auto_sync'] else 'off'}, "
            f"language {saved['language'] or 'auto'}, rustle {saved['rustle_strength']}")
        return {"settings": saved}

    @router.get("/api/sync")
    def sync_status():
        return {"recorders": find_recorders(), "job": syncer.status(), "mode": SYNC_MODE}

    @router.post("/api/sync")
    def sync_start(body: SyncBody):
        try:
            return syncer.start(body.root)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))

    return router
