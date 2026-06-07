# syntax=docker/dockerfile:1.7
#
# Custom RunPod serverless worker для TTS на VoxCPM2 (openbmb/VoxCPM2).
#
# VoxCPM2 — tokenizer-free diffusion AR TTS: 2B параметров, 30 языков, 48kHz,
# Apache 2.0. Voice cloning через reference WAV. Требует CUDA >= 12, PyTorch
# >= 2.5, Python 3.10–3.12, ~8 GB VRAM.
#
# Веса НЕ baked в image — VoxCPM.from_pretrained качает их в HF cache на
# network volume (HF_HOME=/runpod-volume/hf-cache, pre-seed через
# scripts/seed-voxcpm-models.ts). Cold start не качает ~6 GB из HF.
#
# Build:
#   docker buildx build --platform linux/amd64 \
#     -t <docker-hub-user>/worker-tts-voxcpm:<tag> \
#     -f packages/runpod/docker/worker-tts-voxcpm/Dockerfile \
#     packages/runpod/docker/worker-tts-voxcpm
#   docker push <docker-hub-user>/worker-tts-voxcpm:<tag>

FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/runpod-volume/hf-cache \
    HF_HUB_ENABLE_HF_TRANSFER=0

# libsndfile нужен soundfile для записи WAV, ffmpeg — для чтения/конвертации
# reference-аудио произвольных форматов (mp3/m4a/ogg) в WAV перед клонированием.
RUN apt-get update && \
    apt-get install -y --no-install-recommends libsndfile1 ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

COPY handler.py /handler.py

# rp_upload (BUCKET_ENDPOINT_URL) заливает результат в S3; иначе handler
# возвращает base64. Полезный лог при старте, чтобы ловить mount-проблемы.
ENV NETWORK_VOLUME_DEBUG=true

CMD ["python", "-u", "/handler.py"]

LABEL org.opencontainers.image.title="worker-tts-voxcpm" \
      org.opencontainers.image.description="RunPod serverless TTS worker (VoxCPM2) с voice cloning" \
      org.opencontainers.image.source="https://github.com/balkhaev/generator" \
      org.opencontainers.image.licenses="MIT"
