import os
import re
import json
import sqlite3
import subprocess
from pathlib import Path
from datetime import datetime
import numpy as np
import torch
import whisperx
from pyannote.audio import Inference, Model
from scipy.spatial.distance import cdist

# --- CONFIGURATION ---
INPUT_DIR = Path("./RECORD")      # Your voice recorder mount
OUTPUT_DIR = Path("./processed_daily")
DB_PATH = Path("./speaker_memory.db")
HF_TOKEN = os.getenv("HF_TOKEN")   # HuggingFace token for pyannote models
SIMILARITY_THRESHOLD = 0.72       # Threshold for matching known voices
MIN_FILE_SIZE_BYTES = 500 * 1024   # Skip recordings under 500KB (clicks/accidental taps)

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Near top configuration:
device = "cuda" if torch.cuda.is_available() else "cpu"
compute_type = "float16" if device == "cuda" else "int8"

# --- DATABASE SETUP ---
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS speakers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            embedding BLOB,
            sample_count INTEGER DEFAULT 1
        )
    """)
    conn.commit()
    return conn

# --- AUDIO PRE-PROCESSING ---
def get_daily_batches(input_dir: Path):
    batches = {}
    # Captures YYYY-MM-DD in group 1
    pattern = re.compile(r"^V(\d{4}-\d{2}-\d{2})-.*\.mp3$", re.IGNORECASE)
    for file in sorted(input_dir.glob("*.MP3")):
        if file.stat().st_size < MIN_FILE_SIZE_BYTES:
            continue
        match = pattern.search(file.name)
        if match:
            date_key = match.group(1)
            batches.setdefault(date_key, []).append(file)
    return batches

def prepare_daily_audio(date_str: str, file_list: list[Path]) -> Path:
    merged_path = OUTPUT_DIR / f"{date_str}_merged.wav"
    if merged_path.exists():
        return merged_path

    # Build concat file list
    concat_txt = OUTPUT_DIR / f"concat_{date_str}.txt"
    with open(concat_txt, "w") as f:
        for fpath in file_list:
            clean_p = str(fpath.resolve()).replace("\\", "/")
            f.write(f"file '{clean_p}'\n")

    # ffmpeg concat + VOX level filter (highpass + dynamic speechnorm)
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_txt),
        "-af", "highpass=f=80,speechnorm=e=4:r=0.0001:l=1",
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        str(merged_path)
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    concat_txt.unlink(missing_ok=True)
    return merged_path

# --- SPEAKER PROFILE MATCHER ---
class VoiceMemory:
    def __init__(self, conn):
        self.conn = conn
        self.embedding_model = Model.from_pretrained("pyannote/wespeaker-voxceleb-resnet34-LM", use_auth_token=HF_TOKEN)
        self.inference = Inference(self.embedding_model, window="whole")
        if device == "cuda":
            self.embedding_model.to(torch.device("cuda"))

    def get_embedding(self, audio_path: str, start: float, end: float):
        from pyannote.core import Segment
        segment = Segment(start, end)
        emb = self.inference.crop(audio_path, segment)
        return emb.flatten()

    def identify_or_enroll(self, segment_embeddings: list[np.ndarray], temp_label: str) -> str:
        if not segment_embeddings:
            return temp_label
        avg_emb = np.mean(segment_embeddings, axis=0, keepdims=True)
        norm_emb = avg_emb / np.linalg.norm(avg_emb)

        cur = self.conn.cursor()
        cur.execute("SELECT id, name, embedding, sample_count FROM speakers")
        rows = cur.fetchall()

        best_score = -1.0
        matched_id = None
        matched_name = None
        matched_count = 0
        matched_vec = None

        for spk_id, name, blob, count in rows:
            stored_emb = np.frombuffer(blob, dtype=np.float32).reshape(1, -1)
            similarity = 1.0 - cdist(norm_emb, stored_emb, metric="cosine")[0, 0]
            if similarity > best_score:
                best_score = similarity
                matched_id = spk_id
                matched_name = name
                matched_count = count
                matched_vec = stored_emb

        if best_score >= SIMILARITY_THRESHOLD:
            # Update running centroid
            new_count = matched_count + 1
            updated_vec = (matched_vec * matched_count + norm_emb) / new_count
            updated_vec = updated_vec / np.linalg.norm(updated_vec)
            cur.execute("UPDATE speakers SET embedding = ?, sample_count = ? WHERE id = ?",
                        (updated_vec.astype(np.float32).tobytes(), new_count, matched_id))
            self.conn.commit()
            return matched_name
        else:
            # Enroll as a new speaker profile
            new_name = f"Speaker_{len(rows) + 1}"
            cur.execute("INSERT INTO speakers (name, embedding, sample_count) VALUES (?, ?, 1)",
                        (new_name, norm_emb.astype(np.float32).tobytes()))
            self.conn.commit()
            return new_name

# --- MAIN INGEST PIPELINE ---
def process_all():
    conn = init_db()
    memory = VoiceMemory(conn)
    batches = get_daily_batches(INPUT_DIR)

    # Load WhisperX
    whisper_model = whisperx.load_model("large-v3", device, compute_type=compute_type)
    diarize_model = whisperx.DiarizationPipeline(use_auth_token=HF_TOKEN, device=device)

    for date_key, files in batches.items():
        print(f"[*] Processing date: {date_key} ({len(files)} files)...")
        audio_file = prepare_daily_audio(date_key, files)

        # 1. Transcribe
        audio = whisperx.load_audio(str(audio_file))
        result = whisper_model.transcribe(audio, batch_size=16)

        # 2. Word-level align
        align_model, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
        result = whisperx.align(result["segments"], align_model, metadata, audio, device, return_char_alignments=False)

        # 3. Diarize
        diarize_segments = diarize_model(audio_file)
        result = whisperx.assign_word_speakers(diarize_segments, result)

        # 4. Group speaker segments to extract embeddings
        temp_speaker_clips = {}
        for seg in result["segments"]:
            spk = seg.get("speaker", "UNKNOWN")
            if (seg["end"] - seg["start"]) >= 1.5:  # Only use snippets >= 1.5s for clean voice prints
                temp_speaker_clips.setdefault(spk, []).append((seg["start"], seg["end"]))

        # 5. Extract embeddings & match against voice DB
        label_map = {}
        for spk_label, times in temp_speaker_clips.items():
            if spk_label == "UNKNOWN":
                continue
            embeddings = []
            for start, end in times[:5]:  # Sample up to 5 clean segments per speaker
                try:
                    embeddings.append(memory.get_embedding(str(audio_file), start, end))
                except Exception:
                    continue
            if embeddings:
                label_map[spk_label] = memory.identify_or_enroll(embeddings, spk_label)

        # 6. Build final playback payload
        timeline = []
        for seg in result["segments"]:
            raw_spk = seg.get("speaker", "UNKNOWN")
            speaker_name = label_map.get(raw_spk, raw_spk)
            timeline.append({
                "start": round(seg["start"], 2),
                "end": round(seg["end"], 2),
                "speaker": speaker_name,
                "text": seg["text"].strip()
            })

        json_out = OUTPUT_DIR / f"{date_key}_transcript.json"
        with open(json_out, "w") as f:
            json.dump({"date": date_key, "audio": f"{date_key}_merged.wav", "segments": timeline}, f, indent=2)
        print(f"[+] Complete: {json_out}")

if __name__ == "__main__":
    process_all()