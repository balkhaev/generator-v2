# RunPod LTX 2.3 template — operational notes

Тут лежит фактическая инфа про template `p4f6rm9tb4`
(`ls250824/run-comfyui-ltx`) и reference workflow JSON-ы из
[`RuneXX/LTX-2.3-Workflows`](https://huggingface.co/RuneXX/LTX-2.3-Workflows),
которые используются нашим pod-runtime.

## Template

| field | value |
|---|---|
| id | `p4f6rm9tb4` |
| name | LTX 2.3 t2v i2v vi2v vt2v inference with ComfyUI |
| image | `ls250824/run-comfyui-ltx:28042026` |
| `dockerArgs` | `""` (внутри image entrypoint, **не override**) |
| `startScript` | `""` |
| `containerDiskInGb` | 15 |
| `volumeInGb` | 90 (mount `/workspace`) |
| ports | `9000/http,8188/http,22/tcp,22/udp` |

`HF_MODEL_HVRAM_*` / `HF_MODEL_LVRAM_*` env'ы templ'а сами тянут модели в
`/workspace/ComfyUI/models/...` при старте контейнера, поэтому мы НЕ должны
override `dockerStartCmd` — иначе provisioning не запускается, и каждый pod
заново качает 46 GB checkpoint.

## ComfyUI HTTP API внутри pod'а

Прокси: `https://<podId>-8188.proxy.runpod.net`.

### Auth — `liusida/ComfyUI-Login`

1. POST `/login` form-encoded `username=<any>&password=<PASSWORD env>&guest_mode=`
   → `302 Set-Cookie: AIOHTTP_SESSION=...`.
2. Все следующие вызовы — с этой cookie.

При первом /login pod регистрирует пару user/password и сохраняет, последующие
логины проверяют по той же паре. Поэтому пробрасываем стабильный
`PASSWORD` и фиксированный username (например `agent`).

### Стандартные ComfyUI endpoints

| method | path | usage |
|---|---|---|
| GET | `/system_stats` | проверка готовности (200 = ComfyUI up) |
| POST | `/prompt` | `{"prompt": <api_graph>, "client_id": <uuid>}` → `{"prompt_id": "..."}` |
| GET | `/history/{prompt_id}` | финальный output / status |
| GET | `/view?filename=...&type=output&subfolder=...` | бинарь артефакта |
| POST | `/upload/image` | multipart form `image=@...&subfolder=&type=input&overwrite=1` |
| GET | `/api/v2/userdata?dir=<rel>` | список user files (workflows и т.д.) |
| GET | `/api/userdata/<urlencoded-path>` | содержимое user file (без `v2`, путь URL-encoded) |

### Lora Manager (`willmiao/ComfyUI-Lora-Manager`) endpoints

| method | path | usage |
|---|---|---|
| POST | `/api/lm/download-model` | body `{model_id, model_version_id, model_root, relative_path, use_default_paths, download_id, source?}` → старт скачивания LoRA c Civitai |
| GET | `/api/lm/download-progress?download_id=...` | прогресс |
| POST | `/api/lm/cancel-download-get?download_id=...` | отмена |
| GET | `/api/lm/loras/list` | список установленных LoRA |
| GET | `/api/lm/loras/civitai/versions?model_id=...` | список версий с Civitai |
| WS | `/ws/fetch-progress` | live progress (опционально) |

`CIVITAI_TOKEN` env пода используется автоматически Lora Manager-ом и `civitai`
CLI внутри pod'а.

### Готовые workflow JSON-ы внутри pod'а

Лежат в `/workspace/ComfyUI/user/default/workflows/` и доступны через
`GET /api/v2/userdata/workflows%2F<file>.json` (URL-encoded `/`).
Имена с pod'а:

```
LTX-23-i2v-pod-lvram.json                                            (122 KB)
LTX-23-t2v-pod-lvram.json                                            (106 KB)
LTX-23-i2v-t2v-3Pass-pod-lvram.json                                  (177 KB)
LTX-23-I2V-T2V-ID-Lora_reference_audio-pod-lvram.json                (112 KB)
LTX-23-IV2V-TV2V_transfer_body_movements-pod-lvram.json              (197 KB)
LTX-23-IV2V-TV2V_transfer_camera_movements_IC-Cameraman_lora-...    (151 KB)
```

Они в **UI формате** (нодовый граф ComfyUI). Для `/prompt` нужен **API формат**
(plain `{ "<id>": {"class_type", "inputs"} }`). Конвертация UI → API требует
введённого ComfyUI runtime (widget mapping для каждого `class_type`), поэтому
рабочий путь — экспортировать API формат один раз через ComfyUI WebUI
(меню Workflow → Export API), сохранить в этот каталог, и наш pod-engine будет
ним пользоваться, патча только параметры (prompt, image filename, lora_name,
lora_strength, dimensions, frames, seed).

UI-формат всех 6 workflow'ов скачан с живого pod'а и закоммичен в
[`./ui/`](./ui/). Когда будем экспортировать API-формат — этот же pod
поднимается заново, через `cursor-ide-browser` MCP открывается ComfyUI Web UI,
загружается каждый файл, через DevTools console вызывается
`(await app.graphToPrompt()).output`, сохраняется в `./api/<name>.json`.

Reference UI workflows из
[`RuneXX/LTX-2.3-Workflows`](https://huggingface.co/RuneXX/LTX-2.3-Workflows)
(не используются runtime, только как читаемый референс):

- `ltx-2-3-i2v-t2v-simple.json` — Simple Single-Pass i2v/t2v (105 KB)
- `ltx-2-3-i2v-t2v-basic.json`  — Basic i2v/t2v (127 KB)

## VRAM / GPU варианты

- `lvram` (low-VRAM, fp8): RTX A5000 24GB / RTX 4090 24GB. Размер 1280×736, до 20s @ 24fps.
- `hvram` (bf16): L40S 48GB / RTX 6000 Ada 48GB / A6000 48GB. Размер 1920×1088, до 20s @ 24fps.

`HF_MODEL_*VRAM*` env'ы определяют какой checkpoint скачается.

Pod-engine выбирает variant исходя из реально-выданного GPU type у `pod.machine`.
