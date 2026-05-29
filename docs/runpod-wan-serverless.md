# Wan 2.2 I2V / «Wan Pussy» на RunPod serverless

По тому же принципу, что [LTX Synth Pussy serverless](./runpod-serverless-migration.md):
образ `worker-ltx-comfyui`, ComfyUI graph, network volume, admin template
`workflow_key=wan-2-2-video`, Studio workflow `runpod-wan-2-2-image-to-video`.

## Архитектура

| Слой | Компонент |
|------|-----------|
| Docker image | Тот же `worker-ltx-comfyui` (Wan-ноды в ComfyUI core + VHS) |
| RunPod template | `wan-2-2-video-serverless` — `scripts/create-wan-serverless-endpoints.ts` |
| Network volumes | Отдельные `wan22-*` (~35 GB Wan weights + LoRA). **Не** на LTX volumes — не хватает места |
| Workflow code | `packages/runpod/src/workflows/wan-2-2-video-serverless.ts` |
| Studio | Workflow `runpod-wan-2-2-image-to-video`, форма с дефолтом Wan Pussy LoRA |
| LoRA | Civitai model `1895314` / version `2145434` → `wan22-pussy-high_noise.safetensors` + `wan22-pussy-low_noise.safetensors` на volume |

## Чеклист

### 1. Volumes `wan22-*`

В RunPod console создайте network volumes (100 GB) в DC из serverless enum
(например `US-CA-2`, `EU-RO-1`), имя `wan22-<dc>`.

### 2. Seed моделей Wan

```bash
export RUNPOD_API_KEY=rpa_xxx
export HF_TOKEN=hf_xxx   # опционально
bun run packages/runpod/scripts/seed-wan-models-volumes.ts
```

Качает fp8 high/low UNET, umt5, wan_2.1 VAE с HuggingFace Comfy-Org repack.
После старта pod'ов дождитесь sentinel `WAN22_MODELS_SEED_DONE_v1` и terminate pod.

### 3. Seed LoRA Wan Pussy

```bash
export RUNPOD_API_KEY=rpa_xxx
export CIVITAI_API_KEY=...
bun run packages/runpod/scripts/seed-wan-pussy-lora.ts
```

Распаковывает zip Civitai в фиксированные имена на volume.

### 4. Endpoint + template

```bash
export RUNPOD_WAN22_SERVERLESS_IMAGE=<hub>/worker-ltx-comfyui:<tag>
# или RUNPOD_LTX23_SERVERLESS_IMAGE=...
bun run packages/runpod/scripts/create-wan-serverless-endpoints.ts
```

Опционально: `RUNPOD_WAN22_VOLUME_IDS=id1,id2` если volumes не `wan22-*`.

### 5. Admin DB

UI `/runpod → Pod templates` или POST payload из output скрипта:

- Workflow key: `wan-2-2-video`
- Mode: `serverless`
- Volumes: все `wan22-*` (admin DB UUID)

### 6. Generator env (fallback без БД)

```bash
RUNPOD_WAN22_SERVERLESS_ENDPOINT_ID=<endpointId>
RUNPOD_WAN22_ENABLE_WARMUP=true
```

### 7. Studio scenario

1. Создать сценарий с workflow **Wan 2.2 I2V (RunPod)**.
2. Admin → Scenario bindings → привязать serverless pod template.
3. Запуск с input image; LoRA high/low подставляются формой автоматически.

### 8. Smoke

```bash
export RUNPOD_API_KEY=rpa_xxx
export RUNPOD_WAN22_SERVERLESS_ENDPOINT_ID=<id>
bun run packages/runpod/scripts/smoke-wan-serverless.ts
```

## Откат

Выключить Wan serverless template в admin, включить pod/fal fallback — без удаления volume.
