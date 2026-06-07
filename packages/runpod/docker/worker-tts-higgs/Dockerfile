# syntax=docker/dockerfile:1.7
#
# EXPERIMENTAL RunPod serverless worker для TTS на Higgs Audio v3 4B
# (bosonai/higgs-audio-v3-tts-4b).
#
# ВНИМАНИЕ ЛИЦЕНЗИЯ: Higgs Audio v3 — Research & Non-Commercial. Коммерческое
# использование / хостинг требует отдельной лицензии Boson AI. Этот воркер
# включается только если задан RUNPOD_HIGGS_TTS_ENDPOINT_ID и помечен в UI как
# non-commercial.
#
# Higgs v3 сервится через SGLang-Omni: `sgl-omni serve --model-path ... --port`.
# handler.py поднимает sgl-omni как фоновый процесс (один раз на воркер),
# дожидается готовности /health и проксирует jobs в OpenAI-совместимый
# /v1/audio/speech. Тяжёлая модель (4B + multi-codebook decoding) — нужен A100/
# H100, ~24+ GB VRAM.
#
# Веса НЕ baked в image — качаются в HF cache на network volume
# (HF_HOME=/runpod-volume/hf-cache, pre-seed через scripts/seed-higgs-models.ts).
#
# Build:
#   docker buildx build --platform linux/amd64 \
#     -t <docker-hub-user>/worker-tts-higgs:<tag> \
#     -f packages/runpod/docker/worker-tts-higgs/Dockerfile \
#     packages/runpod/docker/worker-tts-higgs
#   docker push <docker-hub-user>/worker-tts-higgs:<tag>

FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/runpod-volume/hf-cache \
    HF_HUB_ENABLE_HF_TRANSFER=0 \
    HIGGS_MODEL_ID=bosonai/higgs-audio-v3-tts-4b \
    HIGGS_SERVER_PORT=8000

# ffmpeg — для чтения/конвертации reference-аудио произвольных форматов;
# libsndfile1 — на случай локальной записи WAV.
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

LABEL org.opencontainers.image.title="worker-tts-higgs" \
      org.opencontainers.image.description="EXPERIMENTAL RunPod serverless TTS worker (Higgs Audio v3 4B) — non-commercial license" \
      org.opencontainers.image.source="https://github.com/balkhaev/generator" \
      org.opencontainers.image.licenses="LicenseRef-BosonAI-NonCommercial"
