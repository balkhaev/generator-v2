# Миграция LTX 2.3 / Sulphur-2 с pod-mode на serverless

Этот документ описывает полный путь переезда LTX 2.3 video inference с
pod-runtime на RunPod serverless. После миграции LTX и Sulphur-2 работают
через единственный multi-region serverless endpoint, без управления pod
жизненным циклом из generator.

## Архитектура — что и где

| слой | компонент |
|---|---|
| Docker image | `runpod/worker-comfyui:5.x-base` + наши custom nodes — `packages/runpod/docker/worker-ltx-comfyui/Dockerfile`. Билдится локально и публикуется на DockerHub. |
| RunPod template | Создаётся через REST API скриптом `scripts/create-serverless-endpoints.ts`. Имя `ltx-2-3-video-serverless`. |
| RunPod endpoint | Multi-region: `dataCenterIds` = все DC где есть наши `ltx23-*` volumes, `networkVolumeIds` = ID этих volumes. GPU priority list — A5000, RTX 4090, A4500, A4000, L4 (24 GB VRAM достаточно для fp8mixed). |
| Network volumes | 10 наших существующих `ltx23-*` volumes (по 100 GB в разных DC). Дописываем на них Sulphur fp8 (29 GB) + distill LoRA (660 MB) скриптом `seed-sulphur-volumes.ts`. |
| Workflow | `packages/runpod/src/workflows/ltx-2-3-video-serverless.ts` — ComfyUI graph (тот же что в pod-mode) + base64 input image inline. Output — MP4 (base64 или S3 URL если на endpoint настроены `BUCKET_*` env). |
| Admin DB | `runpod_pod_template` с `mode=serverless`, `runpodEndpointId`, привязан к 10 `runpod_network_volume` записям. После записи hot-reload bus пушит `pod-template-created`, generator перезапускается и подхватывает workflow. |
| Studio scenario | Привязка `studio_scenario.runpodPodTemplateId` → новая запись. Сценарий `151d1452-bb0b-40a8-b491-14f8a085e003` (`LTX Synth Pussy (Serverless)`) переподключается через UI `/runpod → Scenario bindings`. |

## Шаг-за-шагом — чеклист миграции

### 1. Билд кастомного образа

```bash
docker login -u <docker-hub-user>
cd packages/runpod/docker/worker-ltx-comfyui
docker buildx build --platform linux/amd64 \
  -t <docker-hub-user>/worker-ltx-comfyui:v1 --push .
```

Подробности и список baked custom nodes — см. README в той же папке.

### 2. Заливка Sulphur-2 на 10 volumes

Параллельно поднимает temp pod на каждом volume, скачивает с HuggingFace, terminate.

```bash
export RUNPOD_API_KEY=rpa_xxx
bun run packages/runpod/scripts/seed-sulphur-volumes.ts
```

Что качается:

- `sulphur_dev_fp8mixed.safetensors` (29 GB) → `/workspace/ComfyUI/models/diffusion_models/`
- `sulphur_distil_lora.safetensors` (660 MB) → `/workspace/ComfyUI/models/loras/`
  (originally `distill_loras/ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors`)

Идемпотентно: при повторном запуске видит `/workspace/SULPHUR_SEED_DONE`
sentinel и не качает повторно. На каждый volume — примерно 15-25 минут
(зависит от GPU node bandwidth до HF), все 10 идут параллельно.

`bf16` (46 GB) намеренно НЕ качаем — не помещается рядом с существующим
LTX 2.3 (~40 GB) на 100 GB volume. Если потребуется — освободи место
удалением LTX 2.3 base и пересей.

### 3. Создание RunPod template + serverless endpoint

```bash
export RUNPOD_API_KEY=rpa_xxx
export RUNPOD_LTX23_SERVERLESS_IMAGE=<docker-hub-user>/worker-ltx-comfyui:v1
bun run packages/runpod/scripts/create-serverless-endpoints.ts
```

Идемпотентно по `name`: переиспользует существующий template/endpoint и
обновляет ключевые поля (image, GPU priority, scaler, volumes).

Output печатает `endpointId`, `templateId` и готовый JSON для регистрации
template'а в admin DB.

### 4. Регистрация endpoint'а в admin DB

Сейчас admin payload требует **admin-DB UUID** volumes (не RunPod IDs), а
скрипт пока не делает auto-map. Делается одной из двух дорог:

#### Вариант A — через UI

1. Открыть `/runpod → Pod templates` в admin-web.
2. **Create template**:
   - Name: `LTX 2.3 / Sulphur-2 serverless`
   - Workflow key: `ltx-2-3-video`
   - Mode: `serverless`
   - Runpod endpoint ID: `<вставить из output скрипта>`
   - Runpod template ID: `<вставить>`
   - Image name: `<docker-hub-user>/worker-ltx-comfyui:v1`
   - Enabled: ✓
   - Volumes: выбрать все 10 `ltx23-*` записей.
3. Save → hot-reload bus автоматически перезапускает generator-api и
   generator-worker, новый serverless workflow подключается.

#### Вариант B — через curl

```bash
# 1. Получи admin DB UUIDs наших volumes
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  https://admin.example.com/api/admin/runpod/volumes | jq

# 2. Маппинг runpodVolumeId → id (admin DB UUID).
# 3. Сформируй payload (см. output скрипта create-serverless-endpoints.ts)
#    и подставь в `volumes: [{volumeId: <uuid>, priority: <n>}, ...]`.
# 4. POST:
curl -X POST -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @payload.json \
  https://admin.example.com/api/admin/runpod/pod-templates
```

### 5. Деактивация старого pod-mode template (optional)

В UI `/runpod → Pod templates` найди старый LTX 2.3 pod template и сними
галку **Enabled**. Hot-reload bus перезапустит generator, и при следующем
matchи'нге workflow registry возьмёт только serverless вариант.

⚠️ Не удаляй pod template совсем сразу. Лучше держать его выключенным
неделю как fallback — если serverless кончит давать quality issues, можно
переключить обратно одной галочкой.

### 6. Привязка сценариев

Сценарий `151d1452-bb0b-40a8-b491-14f8a085e003` (`LTX Synth Pussy (Serverless)`) и
другие LTX-сценарии должны указывать на новый pod template:

1. `/runpod → Scenario bindings` в admin-web.
2. Найти scenario по ID.
3. **RunPod pod template** → выбрать новый serverless template.
4. Save → hot-reload bus уведомляет generator.

### 7. Smoke

```bash
export RUNPOD_API_KEY=rpa_xxx
bun run packages/runpod/scripts/smoke-serverless.ts \
  --endpoint=<endpointId> \
  --workflow=raw \
  --prompt="cinematic shot of a cat dancing in the rain"
```

Для real LTX workflow используй submit через generator-api с тем же
scenario, как раньше — но теперь под капотом серверлес.

## Откат

Если что-то пойдёт не так и нужно срочно откатиться:

1. Включить старый pod-mode template (UI checkbox → enabled).
2. Выключить serverless template.
3. Hot-reload bus переподключит generator на pod-runtime.

Volume'ы при этом остаются с обеими моделями (LTX base + Sulphur). Никакие
данные не теряются.

## Ограничения / known issues

- **Custom Civitai LoRAs**: pod-mode умеет тянуть Civitai LoRA в pod через
  Lora Manager API на лету (см. `prepare()` step). Serverless НЕ умеет —
  у worker'а нет HTTP listener'а для in-flight LoRA загрузки. Workflow
  ожидает что Civitai LoRA уже лежит на volume под именем
  `civitai-{modelId}-{versionId}.safetensors`. Если такого файла нет —
  ComfyUI отдаст validation error на /prompt. Решение — отдельный
  warm-up step (TODO) или предзаливка перед запуском сценария.
- **MP4 size**: RunPod /run cap на 10 MB, /runsync — 20 MB. Видео длиной
  > 5-7 секунд при 1280×736 переваливает за 10 MB base64-encoded. Для
  таких выходов **обязательно** настроить S3 upload в endpoint env vars
  (`BUCKET_ENDPOINT_URL`, `BUCKET_NAME`, `BUCKET_ACCESS_KEY_ID`,
  `BUCKET_SECRET_ACCESS_KEY`) — worker-comfyui тогда отдаст `s3_url`
  вместо base64.
- **Cold start**: первый запрос после простоя — ~2-3 минуты (загрузка
  модели 29 GB с NFS в VRAM). FlashBoot включён, но при идле > idleTimeout
  все worker'ы уходят. Для критичных сценариев — поднять `workersMin: 1`
  в endpoint config.
- **bf16 НЕ помещается** рядом с LTX 2.3 на 100 GB volume. Если нужен —
  отдельный скрипт удаляет LTX base перед заливкой bf16.
