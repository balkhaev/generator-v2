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

ARG WORKER_COMFYUI_VERSION=5.8.5
FROM runpod/worker-comfyui:${WORKER_COMFYUI_VERSION}-base

# Custom nodes для LTX 2.3 graph — install через comfy-node-install (CLI
# обёртка над comfy-cli, отличающаяся тем, что non-zero exit при ошибке
# установки; comfy-cli silent-skips, что прячет упавшие nodes).
# Имена сверяются с Comfy Registry (https://registry.comfy.org).
#
# Минимальный набор для `templates/api/ltx-2-3-i2v-lvram.json`:
#   - comfyui-ltxvideo:        LTXV* nodes (LTXVBaseSampler, LTXVConditioning,
#                              LTXVScheduler, LTXVImgToVideoInplace и др.)
#   - comfyui-kjnodes:         LTX2* nodes (LTX2SamplingPreviewOverride,
#                              LTX2_NAG, LoraManager-фолбэки), ManualSigmas,
#                              ImageResizeKJv2, SimpleCalculatorKJ, VAELoaderKJ,
#                              GetImageSize, ResizeImagesByLongerEdge, PreviewAny.
#   - comfyui-videohelpersuite: VHS_VideoCombine (mp4 output).
#   - comfyui_essentials:      ResizeImageMaskNode и др. вспомогалки.
#
# Намеренно НЕ ставим:
#   - comfyui-frame-interpolation (тянет cupy-cuda12x, ~3GB) — i2v graph его
#     не использует.
#   - rgthree-comfy — UX-пакет для редактирования графа в Web UI, в API-mode
#     серверлесса не нужен.
#   - comfyui-lora-manager — кастомный `Lora Loader (LoraManager)` (node 366)
#     мы переписываем на стороне `buildPayload` в стандартный LoraLoaderModelOnly
#     либо вообще удаляем (см. `ltx-2-3-video-serverless.ts`).
RUN comfy-node-install \
    comfyui-ltxvideo \
    comfyui-kjnodes \
    comfyui-videohelpersuite \
    comfyui_essentials

# LTX 2.3 audio VAE имеет обновлённые layer names — стандартный
# VAELoader и устаревший VAELoaderKJ возвращают `None` (issue Kijai
# #608, HF discussion 5). Поэтому берём свежие ComfyUI core и
# comfyui-kjnodes (после Kijai's fix), где:
#   1) стандартный VAELoader умеет audio VAE;
#   2) лежат fixed VAELoaderKJ и LTX2 nodes со знанием нового layer naming;
#   3) объявлены новые runtime deps (например diffusers >=0.30 для AudioVAE).
#
# Пинним на конкретные commit SHA (не плавающий master) — иначе каждый билд
# тянет разный код и образ невоспроизводим. Бампать SHA вручную при апдейте
# (проверять, что LTX 2.3 audio VAE и LTX2 nodes ещё работают).
ARG COMFYUI_SHA=e7214d78eef4c87cd042bc29ec322ad6a2d1509b
ARG KJNODES_SHA=51d4261b683b4ed5645c1fe2ce3616d4e3fba090
RUN set -eux; \
    cd /comfyui && git fetch --depth 1 origin "${COMFYUI_SHA}" && \
    git checkout "${COMFYUI_SHA}" && \
    pip install --no-cache-dir -r requirements.txt; \
    cd /comfyui/custom_nodes && \
    rm -rf ComfyUI-KJNodes comfyui-kjnodes && \
    git clone https://github.com/kijai/ComfyUI-KJNodes.git && \
    cd ComfyUI-KJNodes && git checkout "${KJNODES_SHA}" && \
    pip install --no-cache-dir -r requirements.txt || true

# `extra_model_paths.yaml` копируется в стандартный ComfyUI location —
# `/comfyui/extra_model_paths.yaml`. ComfyUI парсит его при старте и
# присоединяет указанные директории к pool'у моделей. Наши volume'ы
# исторически имеют структуру `/workspace/ComfyUI/models/...` (унаследовано
# от pod-mode image `ls250824/run-comfyui-ltx`), поэтому в YAML мы
# мапим эти исходные пути в стандартные ComfyUI ключи.
COPY extra_model_paths.yaml /comfyui/extra_model_paths.yaml

# Свой handler.py (завендоренный upstream 5.8.5 + наши правки) кладём поверх
# базового /handler.py. Версионируется в репо, диффится, без sed-патчей по
# текстовым анкорам. Содержит: обработку video-выходов (gifs/videos от
# VHS_VideoCombine), per-request докачку динамических Civitai-LoRA и
# sentinel-диагностику. См. handler.py.
#
# ВАЖНО: при бампе WORKER_COMFYUI_VERSION пере-вендорить handler.py из новой
# upstream-версии (иначе можно затереть свежие фиксы базового handler'а).
COPY handler.py /handler.py

# CMD от base image (worker-comfyui:5.8.5-base) = ["/start.sh"], который сам
# поднимает ComfyUI + RunPod handler. Статические модели (audio VAE, spatial
# upscaler, база, distill LoRA) — единый источник правды на network volume,
# заливаются через `scripts/seed-ltx-aux-models.ts`. Никакого runtime-bootstrap
# из HF: cold start не качает гигабайты, образ остаётся тонким.
CMD ["/start.sh"]

# Health/debug hint в логах при старте контейнера, чтобы быстрее ловить
# проблемы с моунтом volume / отсутствующими файлами.
ENV NETWORK_VOLUME_DEBUG=true

LABEL org.opencontainers.image.title="worker-ltx-comfyui" \
      org.opencontainers.image.description="RunPod serverless worker для LTX 2.3 / Sulphur-2 video inference на ComfyUI" \
      org.opencontainers.image.source="https://github.com/balkhaev/generator" \
      org.opencontainers.image.licenses="MIT"
