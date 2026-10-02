"""What has to be set up before transcription can run (token, ffmpeg, gated models)."""
import shutil

from app_config import HF_TOKEN
from core.config import GATED_MODELS, INPUT_DIR, log

def setup_problems() -> list[str]:
    problems = []
    if not INPUT_DIR.is_dir():
        problems.append(f"Recordings folder not found: {INPUT_DIR}  (set RECORD_DIR to override)")
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        problems.append("ffmpeg is not on PATH. Install it (e.g. `winget install Gyan.FFmpeg`) and reopen your terminal.")
    if not HF_TOKEN:
        problems.append("HF_TOKEN is not set. Create a token at https://huggingface.co/settings/tokens, accept the "
                        "pyannote model terms, then put  HF_TOKEN=hf_...  in a .env file (see .env.example).")
    return problems

def model_access_problems() -> list[str]:
    """Check up front that the HF token can read the gated pyannote models."""
    from huggingface_hub import HfApi
    from huggingface_hub.errors import GatedRepoError, HfHubHTTPError

    api = HfApi()
    problems = []
    for repo in GATED_MODELS:
        try:
            api.auth_check(repo, token=HF_TOKEN)
        except GatedRepoError:
            problems.append(f"Accept the user conditions at https://huggingface.co/{repo} (log in, click 'Agree').")
        except HfHubHTTPError as e:
            status = getattr(e.response, "status_code", None)
            if status == 401:
                problems.append("HF_TOKEN is invalid or expired. Create a new one at https://huggingface.co/settings/tokens")
                break
            if status == 403:
                problems.append(
                    "Your HF token is fine-grained and can't read gated repos. At "
                    "https://huggingface.co/settings/tokens edit the token and tick "
                    "'Read access to contents of all public gated repos you can access' "
                    "(or create a classic 'Read' token instead).")
                break
            problems.append(f"Couldn't check {repo}: {e}")
        except Exception as e:
            log(f"(Skipping Hugging Face access check: {e})")
            return []
    return list(dict.fromkeys(problems))
