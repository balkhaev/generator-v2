# RunPod ai-toolkit handler (экспериментально)

Этот контейнер — drop-in замена `fal-ai/z-image-trainer` для тренировки
персон-LoRA. Работает на RunPod Serverless с
[ai-toolkit (Ostris)](https://github.com/ostris/ai-toolkit) под капотом и
поддерживает несколько базовых моделей (Z-Image, FLUX 1/2, SDXL, Qwen-Image).

Связь с приложением: handler принимает payload, который шлёт
`apps/admin/src/providers/runpod-ai-toolkit-lora-training.ts`, и возвращает
ссылку на финальный `.safetensors` в нашем S3.

## Когда нужен

Эксперимент: проверить, что ai-toolkit на RunPod даёт сопоставимое (или лучшее)
качество персон-LoRA, чем `fal-ai/z-image-trainer`, при контролируемых расходах
на GPU. Существующий fal-runner остаётся дефолтом — переключение через
`TRAINING_PROVIDER=runpod`.

## Сборка и публикация образа

```bash
cd tools/runpod-ai-toolkit

# 1. Сборка (на машине с docker buildx, желательно amd64+gpu).
docker buildx build \
  --platform linux/amd64 \
  --build-arg AI_TOOLKIT_REV=main \
  -t YOUR_DOCKERHUB/runpod-ai-toolkit:latest \
  --push .
```

Если на M-серии Apple, явно `--platform linux/amd64` (RunPod GPU = amd64).

> Совет: после первой успешной тренировки замените `AI_TOOLKIT_REV=main` на
> конкретный коммит, чтобы зафиксировать поведение и репродуцировать билды.

## Деплой Serverless Endpoint

1. RunPod → Serverless → New Endpoint.
2. Container Image: `YOUR_DOCKERHUB/runpod-ai-toolkit:latest`.
3. GPU: `RTX A6000 (48GB)` или `RTX 6000 Ada (48GB)`. Для FLUX 2 / Qwen — лучше
   48 GB. Для Z-Image / SDXL хватит `RTX 4090 (24GB)`.
4. Container Disk: ≥ 50 GB.
5. Network Volume: подмонтировать на `/runpod-volume` (туда кэшируется HF) —
   очень рекомендуется, иначе каждый cold start будет тянуть 10+ GB модели.
6. Worker Configuration:
   - Max Workers: 1 (эксперимент, расширим позже).
   - Idle Timeout: `5s` (мы не пинговый сервис, держать тёплым смысла нет).
   - Execution Timeout: **`7200`** (2 часа). Иначе серверлес убьёт длинную
     тренировку.
   - Flashboot: `enabled` если есть network volume с HF-кэшем.
7. Environment Variables (см. ниже).

После создания endpoint скопируй `Endpoint ID` — его нужно прописать в
`RUNPOD_AI_TOOLKIT_ENDPOINT_ID` нашего admin-worker (.env / Coolify).

## Environment Variables (RunPod endpoint)

S3-креды нужны handler-у, чтобы залить финальный `.safetensors`. Лучше отдать
ту же связку, что использует наш admin-worker, — тогда LoRA сразу окажется в
нашем bucket-е, и `persistLoraWeightsToS3` в TypeScript-runner-е просто
скачает по тому же URL и зальёт повторно (или скипнет — TODO).

| Переменная | Обязательно | Пример | Что |
| --- | --- | --- | --- |
| `S3_BUCKET` | да | `lora-artifacts` | bucket для весов |
| `S3_REGION` | да | `eu-central-1` | регион (для AWS) |
| `S3_ENDPOINT` | для R2/MinIO | `https://<accid>.r2.cloudflarestorage.com` | endpoint url |
| `S3_PUBLIC_BASE_URL` | желательно | `https://assets.example.com` | для генерации публичной ссылки |
| `S3_PREFIX` | нет | `loras/runpod-ai-toolkit` | префикс key |
| `AWS_ACCESS_KEY_ID` | да | `AKIA…` | креды |
| `AWS_SECRET_ACCESS_KEY` | да | `…` | креды |
| `HF_TOKEN` | для FLUX/Qwen gated | `hf_…` | для скачивания gated weights |

## Контракт payload (input)

См. шапку [`handler.py`](./handler.py). Кратко:

```json
{
  "input": {
    "dataset_url":     "https://assets.example.com/...persona-dataset.zip",
    "trigger_word":    "ohwx_anna",
    "default_caption": "a photo of ohwx_anna woman, candid reference photograph",
    "training_steps":  1200,
    "learning_rate":   0.0001,
    "lora_rank":       16,
    "base_model":      "z-image",
    "output_name":     "anna-runpod-lora-1717000000"
  }
}
```

И output:

```json
{
  "lora_url":         "https://assets.example.com/loras/runpod-ai-toolkit/anna-runpod-lora-...safetensors",
  "lora_size_bytes":  185342128,
  "training_seconds": 2480.4,
  "debug": {
    "config_summary": { "base_model": "z-image", "training_steps": 1200, "image_count": 25 },
    "stdout_tail":    "..."
  }
}
```

## Маппинг base_model → ai-toolkit

| `base_model` (наш) | ai-toolkit `model.name_or_path` | Совместимость с downstream-инференсом |
| --- | --- | --- |
| `z-image` | `Tongyi-MAI/Z-Image-Turbo` | `fal-ai/z-image/turbo/lora` (наш дефолт) |
| `flux-dev` | `black-forest-labs/FLUX.1-dev` | `fal-ai/flux-lora` |
| `flux-schnell` | `black-forest-labs/FLUX.1-schnell` | требуется отдельный schnell-lora workflow |
| `flux2-dev` | `black-forest-labs/FLUX.2-dev` | пока нет; подключить через FLUX 2 LoRA-инференс |
| `sdxl` | `stabilityai/stable-diffusion-xl-base-1.0` | `runpod-fooocus-sdxl` (custom RunPod Fooocus endpoint) |
| `qwen-image` | `Qwen/Qwen-Image` | пока нет в registry |

> Для совместимости с инференсом тренируй `base_model=z-image-turbo`. Workflow
> `fal-zimage-turbo` всегда уходит в `/lora` endpoint, так что обученные веса
> сразу подхватятся через опциональное поле `loraUrl` в сценарии.

## Локальный smoke-тест handler-а (без RunPod)

Внутри docker-контейнера запусти `python /opt/handler.py` с подменённым
`runpod.serverless.start` — простой способ:

```bash
docker run --rm -it --gpus all \
  -e S3_BUCKET=... -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... \
  YOUR_DOCKERHUB/runpod-ai-toolkit:latest \
  python -c "from handler import handler; import json; \
print(json.dumps(handler({'input': { /* payload */ }}), indent=2))"
```

## Известные ограничения

- **Recovery**. Если admin-worker упадёт во время polling-а, RunPod дотренирует
  job сам (он независимый), но воркер не подхватит результат и не отметит
  персону `ready`. Для эксперимента ОК — перезапустить тренировку руками. Если
  понадобится resume — добавить такой же `resumeFromProviderJob` как у
  `FalZibLoraTrainingRunner`, искать активные jobs через `/status` (RunPod
  хранит результаты ~30 минут после завершения).
- **Cold start**. Первый запрос на «холодный» endpoint скачает образ (~10 GB)
  и базовую модель (~12 GB Z-Image, ~24 GB FLUX 2). С network volume и
  flashboot последующие — за десятки секунд.
- **Z-Image поддержка в ai-toolkit относительно свежая**. Если апстрим что-то
  поломает — пин `AI_TOOLKIT_REV` на работающий коммит.
