# syntax=docker/dockerfile:1.7
#
# Custom RunPod serverless worker для LTX 2.3 / Sulphur-2 video pipeline.
#
# База: официальный `runpod/worker-comfyui:<version>-base` — clean ComfyUI
# install + serverless handler. Поверх ставим custom nodes, нужные нашему
# `templates/api/ltx-2-3-i2v-lvram.json` графу, и подкладываем
# `extra_model_paths.yaml`, чтобы ComfyUI видел модели на network volume,
# смонтированном в `/runpod-volume`.
#
# Модели НЕ baked в image — они лежат на network volume (managed через
# `scripts/seed-sulphur-volumes.ts` и `warmup-volumes.ts`). Это даёт два
# плюса: (1) cold-start не качает 40 GB из HF, (2) base-checkpoint можно
# заменить (LTX 2.3 base ↔ Sulphur-2) без редеплоя image.
#
# Build:
#   docker buildx build --platform linux/amd64 \
#     -t <docker-hub-user>/worker-ltx-comfyui:<tag> \
#     -f packages/runpod/docker/worker-ltx-comfyui/Dockerfile \
#     packages/runpod/docker/worker-ltx-comfyui
#   docker push <docker-hub-user>/worker-ltx-comfyui:<tag>

ARG WORKER_COMFYUI_VERSION=5.5.0
FROM runpod/worker-comfyui:${WORKER_COMFYUI_VERSION}-base

# Custom nodes для LTX 2.3 graph — install через comfy-node-install (CLI
# обёртка над comfy-cli, отличающаяся тем, что non-zero exit при ошибке
# установки; comfy-cli silent-skips, что прячет упавшие nodes).
# Имена сверяются с Comfy Registry (https://registry.comfy.org).
RUN comfy-node-install \
    comfyui-ltxvideo \
    comfyui-kjnodes \
    comfyui-videohelpersuite \
    comfyui_essentials \
    comfyui-frame-interpolation \
    rgthree-comfy

# `extra_model_paths.yaml` копируется в стандартный ComfyUI location —
# `/comfyui/extra_model_paths.yaml`. ComfyUI парсит его при старте и
# присоединяет указанные директории к pool'у моделей. Наши volume'ы
# исторически имеют структуру `/workspace/ComfyUI/models/...` (унаследовано
# от pod-mode image `ls250824/run-comfyui-ltx`), поэтому в YAML мы
# мапим эти исходные пути в стандартные ComfyUI ключи.
COPY extra_model_paths.yaml /comfyui/extra_model_paths.yaml

# Health/debug hint в логах при старте контейнера, чтобы быстрее ловить
# проблемы с моунтом volume / отсутствующими файлами.
ENV NETWORK_VOLUME_DEBUG=true

LABEL org.opencontainers.image.title="worker-ltx-comfyui" \
      org.opencontainers.image.description="RunPod serverless worker для LTX 2.3 / Sulphur-2 video inference на ComfyUI" \
      org.opencontainers.image.source="https://github.com/balkhaev/generator" \
      org.opencontainers.image.licenses="MIT"
