# worker-tts-higgs (EXPERIMENTAL)

RunPod serverless TTS worker на [Higgs Audio v3 4B](https://huggingface.co/bosonai/higgs-audio-v3-tts-4b)
(Boson AI). Conversational TTS, 100+ языков, zero-shot voice cloning, inline
control над эмоцией/просодией/паузами.

> **Лицензия: Research & Non-Commercial.** Коммерческое использование или
> хостинг требует отдельной лицензии Boson AI. Этот воркер включается только
> когда задан `RUNPOD_HIGGS_TTS_ENDPOINT_ID`, скрыт из общего списка
> (`hiddenFromList`) и помечен в UI Persons как non-commercial.

Higgs v3 сервится через [SGLang-Omni](https://github.com/sgl-project/sglang-omni)
(`sgl-omni serve`, OpenAI-совместимый `/v1/audio/speech`). `handler.py` поднимает
сервер фоновым процессом один раз на воркер и проксирует jobs. Модель тяжёлая
(4B + multi-codebook decoding) — нужен A100/H100, ~24+ GB VRAM.

## Контракт

Вход (`job["input"]`) совпадает с `worker-tts-voxcpm`:

```jsonc
{
  "text": "Hello, how are you?",         // обязательный
  "referenceAudioUrl": "https://.../voice.wav", // voice cloning (опц.)
  "referenceText": "transcript",          // улучшает клон (опц.)
  "language": "en",                        // подсказка языка (опц.)
  "emotion": "amusement",                  // inline <|emotion:...|> (опц.)
  "style": "expressive_high",              // inline <|prosody:...|> (опц.)
  "temperature": 0.3,                      // сэмплинг (опц.)
  "topK": 50,                              // top-k (опц.)
  "maxNewTokens": 1024                     // лимит токенов (опц.)
}
```

Выход:

```jsonc
{ "audio": [{ "filename": "higgs-xxx.wav", "type": "s3_url", "data": "https://..." }] }
```

При `BUCKET_ENDPOINT_URL` результат заливается в S3 (`type: "s3_url"`), иначе
возвращается base64 (`type: "base64"`).

## Build & push

```bash
docker buildx build --platform linux/amd64 \
  -t <docker-hub-user>/worker-tts-higgs:v1 \
  -f packages/runpod/docker/worker-tts-higgs/Dockerfile \
  packages/runpod/docker/worker-tts-higgs
docker push <docker-hub-user>/worker-tts-higgs:v1
```

## Seed моделей на volume

Веса не baked в образ. Pre-seed HF cache на `higgs-*` network volume:

```bash
RUNPOD_API_KEY=rpa_xxx HF_TOKEN=hf_xxx \
  bun run packages/runpod/scripts/seed-higgs-models.ts
```

Worker читает кеш из `HF_HOME=/runpod-volume/hf-cache`.

## Provision endpoint

```bash
RUNPOD_API_KEY=rpa_xxx \
RUNPOD_HIGGS_TTS_SERVERLESS_IMAGE=<hub>/worker-tts-higgs:v1 \
  bun run packages/runpod/scripts/create-tts-serverless-endpoints.ts
```

Затем выставить `RUNPOD_HIGGS_TTS_ENDPOINT_ID` для generator (env-default) или
зарегистрировать template в admin DB (`workflowKey: "tts-higgs"`).

## Smoke

```bash
RUNPOD_API_KEY=rpa_xxx RUNPOD_HIGGS_TTS_ENDPOINT_ID=<id> \
  bun run packages/runpod/scripts/smoke-tts-serverless.ts
```
