"""Starts uvicorn with the viewer app."""
import threading

from core.config import INPUT_DIR, log, OUTPUT_DIR
from web.app import create_app


def serve(host: str, port: int, open_browser: bool = True, auto_process: bool = True, force: bool = False):
    import webbrowser
    import uvicorn

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    url = f"http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{port}"
    log(f"\nViewer running at {url}  (Ctrl+C to stop)")
    if host == "0.0.0.0":
        log("  Listening on all network interfaces: anyone on your network can open your recordings.")
    if auto_process:
        log(f"  Watching {INPUT_DIR}: new or incomplete days are transcribed in the background.")
    if open_browser:
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    uvicorn.run(create_app(auto_process, force), host=host, port=port, log_level="warning")
