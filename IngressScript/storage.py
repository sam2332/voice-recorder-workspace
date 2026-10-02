"""The SQLite database for speakers and their voiceprints.

Kept separate from the voice-memory logic so both the voice module and other
routes can open a connection without importing through `voice_memory`.

A fresh connection is opened on every call: SQLite connections must stay on the
thread that created them (see Mistakes.md), and the background worker's thread
changes between jobs.
"""
import sqlite3

from app_config import DB_PATH


def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS speakers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            embedding BLOB,
            sample_count INTEGER DEFAULT 1
        );
        -- Several voiceprints per person (one per day they were heard), so matching
        -- copes with different rooms, mics and moods instead of one blurred average.
        CREATE TABLE IF NOT EXISTS voiceprints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            speaker_id INTEGER NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
            embedding BLOB NOT NULL,
            seconds REAL,
            day TEXT,
            created REAL
        );
    """)
    # Which of the day's diarization voices a print came from, so naming that voice can move it
    if "label" not in {r[1] for r in conn.execute("PRAGMA table_info(voiceprints)")}:
        conn.execute("ALTER TABLE voiceprints ADD COLUMN label TEXT")
    # kind = 'tv' marks a TV / YouTube / music voice: matched like a person, but its lines are hidden as noise
    if "kind" not in {r[1] for r in conn.execute("PRAGMA table_info(speakers)")}:
        conn.execute("ALTER TABLE speakers ADD COLUMN kind TEXT")
    # Older databases kept a single averaged embedding per speaker; keep it as a 'legacy' print
    conn.execute("""
        INSERT INTO voiceprints (speaker_id, embedding, seconds, day, created)
        SELECT id, embedding, 0, 'legacy', 0 FROM speakers s
        WHERE embedding IS NOT NULL AND NOT EXISTS (SELECT 1 FROM voiceprints v WHERE v.speaker_id = s.id)
    """)
    conn.commit()
    return conn


def list_speakers():
    """Print known speakers (used by the --speakers CLI flag)."""
    conn = init_db()
    rows = conn.execute("SELECT id, name, sample_count FROM speakers ORDER BY id").fetchall()
    conn.close()
    if not rows:
        print("No speakers enrolled yet.", flush=True)
        return
    print(f"{'ID':>4}  {'Name':<24} Samples", flush=True)
    for spk_id, name, count in rows:
        print(f"{spk_id:>4}  {name:<24} {count}", flush=True)
