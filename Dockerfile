# CUDA 12.8 + cuDNN 9: needed by faster-whisper (CTranslate2) and for RTX 50-series (Blackwell) GPUs
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models \
    IN_DOCKER=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY IngressScript/app.py IngressScript/viewer.html ./IngressScript/

# Data locations inside the container (mounted from the host by docker-compose.yml)
ENV RECORD_DIR=/data/RECORD \
    OUTPUT_DIR=/data/state/processed_daily \
    SPEAKER_DB=/data/state/speaker_memory.db \
    HOST=0.0.0.0 \
    PORT=5000

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/api/library', timeout=4)"

CMD ["python", "IngressScript/app.py", "--no-browser"]
