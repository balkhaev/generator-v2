# RunPod serverless image для тренировки LoRA через ai-toolkit (Ostris).
#
# Базовый образ с CUDA 12.1 + PyTorch — совместим с большинством современных
# GPU на RunPod (A40 / A6000 / RTX 4090 / RTX 6000 Ada / H100). Если будут
# воркеры на CUDA 12.4+, базу можно заменить на runpod/pytorch:2.4.0-py3.11-cuda12.4-devel.

FROM runpod/pytorch:2.2.1-py3.10-cuda12.1.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/runpod-volume/hf-cache \
    TRANSFORMERS_CACHE=/runpod-volume/hf-cache \
    AI_TOOLKIT_PATH=/opt/ai-toolkit

WORKDIR /opt

# Системные зависимости (git-lfs нужен ai-toolkit для больших чекпоинтов).
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        git-lfs \
        ffmpeg \
        libgl1 \
        libglib2.0-0 \
    && git lfs install \
    && rm -rf /var/lib/apt/lists/*

# Pin ai-toolkit на dev-ветку — закрепить через ARG AI_TOOLKIT_REV
# когда зафиксируем рабочий коммит.
ARG AI_TOOLKIT_REV=main
RUN git clone --recursive https://github.com/ostris/ai-toolkit.git ${AI_TOOLKIT_PATH} \
    && cd ${AI_TOOLKIT_PATH} \
    && git checkout ${AI_TOOLKIT_REV} \
    && git submodule update --init --recursive

# Зависимости ai-toolkit (включая bitsandbytes для adamw8bit).
RUN pip install --upgrade pip \
    && pip install -r ${AI_TOOLKIT_PATH}/requirements.txt

# Зависимости handler-а.
COPY requirements.txt /opt/handler-requirements.txt
RUN pip install -r /opt/handler-requirements.txt

# Handler.
COPY handler.py /opt/handler.py

# RunPod ожидает выполнение python <handler> в качестве entrypoint.
CMD ["python", "-u", "/opt/handler.py"]
