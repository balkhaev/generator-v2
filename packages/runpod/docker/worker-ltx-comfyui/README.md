# worker-ltx-comfyui

Custom RunPod **serverless** worker для LTX 2.3 / Sulphur-2 video inference на
ComfyUI. Сделан как тонкий слой поверх официального
[`runpod/worker-comfyui`](https://github.com/runpod-workers/worker-comfyui):
добавляет custom nodes, требуемые нашему `templates/api/ltx-2-3-i2v-lvram.json`
графу, кладёт поверх свой `handler.py` (видео-выходы + динамические LoRA) и
подкладывает `extra_model_paths.yaml` чтобы ComfyUI видел модели на network
volume, смонтированном в `/runpod-volume`.

## Архитектура (что важно)

- **Свой `handler.py`** — завендоренный upstream-handler (pinned к версии base
  image) + наши правки прямо в коде: обработка `gifs`/`videos` от
  `VHS_VideoCombine`, per-request докачка динамических Civitai-LoRA, sentinel.
  Кладётся поверх `/handler.py` через `COPY` (без sed-патчей). При бампе
  `WORKER_COMFYUI_VERSION` — пере-вендорить из новой upstream-версии.
- **ComfyUI / KJNodes запинены на commit SHA** (`COMFYUI_SHA`, `KJNODES_SHA` в
  Dockerfile) — воспроизводимый билд, без плавающего `master`.
- **Network volume — единый источник правды для моделей.** Все статические веса
  (база LTX/Sulphur, audio VAE, spatial upscaler, distill LoRA) заливаются один
  раз через seed-скрипты. Runtime ничего не качает с HF (нет cold-start
  bootstrap). Единственное исключение — динамические Civitai-LoRA, которые
  выбираются per-scenario: их `handler.py` докачивает на volume при первом
  запросе и кеширует для всех последующих.

## Build & push

Эти команды выполняются один раз с твоей машины (или из CI). Образ публикуется
на DockerHub под твоим аккаунтом и затем подтягивается RunPod'ом при создании
endpoint'а.

```bash
# 1. Создай Docker Hub repo `<docker-hub-user>/worker-ltx-comfyui`
docker login -u <docker-hub-user>

# 2. Билдим под linux/amd64 (RunPod не запускает arm)
cd packages/runpod/docker/worker-ltx-comfyui
docker buildx build \
  --platform linux/amd64 \
  --tag <docker-hub-user>/worker-ltx-comfyui:v1 \
  --push \
  .

# 3. Зафиксируй tag — он понадобится для RUNPOD_LTX23_SERVERLESS_IMAGE
echo "RUNPOD_LTX23_SERVERLESS_IMAGE=<docker-hub-user>/worker-ltx-comfyui:v1"
```

## Что внутри

- Базовый image: `runpod/worker-comfyui:<WORKER_COMFYUI_VERSION>-base` —
  чистая ComfyUI инсталляция + serverless handler. По умолчанию `5.8.5`,
  override через `--build-arg WORKER_COMFYUI_VERSION=...`.
- Custom nodes, нужные нашему графу (только эти, см. Dockerfile):
  - `comfyui-ltxvideo` — `LTXVScheduler`, `LTXAttentionMaskOverride` etc
  - `comfyui-kjnodes` — `INTConstant`, `VAELoaderKJ`, `ImageResizeKJv2`,
    LTX2 nodes (запинено к `KJNODES_SHA`)
  - `comfyui-videohelpersuite` — `VHS_VideoCombine` (MP4 output)
  - `comfyui_essentials` — `PrimitiveStringMultiline` и базовые helpers
  - НЕ ставим `comfyui-frame-interpolation` (тянет ~3GB cupy) и `rgthree-comfy`
    (UX-пакет, в API-mode не нужен).
- `handler.py` — завендоренный upstream-handler + наши правки (video-выходы,
  динамические LoRA, sentinel), кладётся поверх `/handler.py`.
- `extra_model_paths.yaml` — мапит наши volume-paths в стандартные ComfyUI
  ключи. Поддерживает обе layout'ы: исторический `/runpod-volume/ComfyUI/models/...`
  (pod-mode наследие) и нативный flat `/runpod-volume/models/...`.

## Локальный smoke

ComfyUI с серверлес-хендлером тяжело запустить локально (нужен GPU для нагрузки
графа), но можно проверить корректность ComfyUI graph валидации без full
inference:

```bash
docker run --rm --gpus all \
  -v $PWD/local-volume:/runpod-volume \
  -p 8188:8188 \
  <docker-hub-user>/worker-ltx-comfyui:v1 \
  /usr/bin/python3 /comfyui/main.py --listen 0.0.0.0 --port 8188 --cpu-only
# затем загрузи api graph через http://localhost:8188 и нажми Queue Prompt
```

Для реальной проверки используй `bun run packages/runpod/scripts/smoke-serverless.ts`
после создания endpoint'а.

## Доставка моделей (volume = единый источник правды)

Статические веса заливаются на network volume один раз, runtime ничего не
качает с HF:

- `packages/runpod/scripts/seed-ltx-aux-models.ts` — audio VAE (365 MB) +
  spatial upscaler (996 MB) на volume serverless-endpoint'а. **Запускать после
  создания нового volume** (иначе worker отдаст `VAE is invalid`).
- `packages/runpod/scripts/seed-sulphur-volumes.ts` — заливает
  `sulphur_dev_fp8mixed.safetensors` + distill LoRA на все ltx23-volumes.
- `packages/runpod/scripts/warmup-volumes.ts` — оригинальный warm-up для
  LTX 2.3 моделей (pre-Sulphur).

Динамические Civitai-LoRA (per-scenario `loraCivitaiModelId`) НЕ pre-seed'ятся —
их докачивает `handler.py` при первом запросе и кеширует на volume.

## Связанные скрипты

- `packages/runpod/scripts/create-serverless-endpoints.ts` — создаёт RunPod
  template + multi-region serverless endpoint через REST API.

Гайд по полной миграции pod → serverless см.
[`docs/runpod-serverless-migration.md`](../../../../docs/runpod-serverless-migration.md).
