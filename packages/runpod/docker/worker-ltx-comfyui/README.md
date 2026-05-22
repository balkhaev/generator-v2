# worker-ltx-comfyui

Custom RunPod **serverless** worker для LTX 2.3 / Sulphur-2 video inference на
ComfyUI. Сделан как тонкий слой поверх официального
[`runpod/worker-comfyui`](https://github.com/runpod-workers/worker-comfyui):
добавляет custom nodes, требуемые нашему `templates/api/ltx-2-3-i2v-lvram.json`
графу, и подкладывает `extra_model_paths.yaml` чтобы ComfyUI видел модели на
network volume, смонтированном в `/runpod-volume`.

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
  чистая ComfyUI инсталляция + serverless handler. По умолчанию `5.5.0`,
  override через `--build-arg WORKER_COMFYUI_VERSION=...`.
- Custom nodes, нужные нашему графу:
  - `comfyui-ltxvideo` — `LTXVScheduler`, `LTXAttentionMaskOverride` etc
  - `comfyui-kjnodes` — `INTConstant`, `VAELoaderKJ`, `ImageResizeKJv2`
  - `comfyui-videohelpersuite` — `VHS_VideoCombine` (MP4 output)
  - `comfyui_essentials` — `PrimitiveStringMultiline` и базовые helpers
  - `comfyui-frame-interpolation` — на случай interpolation step'а
  - `rgthree-comfy` — control nodes для workflow inspection
- `extra_model_paths.yaml` — мапит наши volume-paths в стандартные ComfyUI
  ключи. Поддерживает обе layout'ы: исторический `/runpod-volume/workspace/ComfyUI/models/...`
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

## Связанные скрипты

- `packages/runpod/scripts/seed-sulphur-volumes.ts` — заливает
  `sulphur_dev_fp8mixed.safetensors` + distill LoRA на все 10 volumes.
- `packages/runpod/scripts/create-serverless-endpoints.ts` — создаёт RunPod
  template + multi-region serverless endpoint через REST API.
- `packages/runpod/scripts/warmup-volumes.ts` — оригинальный warm-up для
  LTX 2.3 моделей (pre-Sulphur).

Гайд по полной миграции pod → serverless см.
[`docs/runpod-serverless-migration.md`](../../../../docs/runpod-serverless-migration.md).
