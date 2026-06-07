# worker-tts-voxcpm

RunPod serverless TTS worker на [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2)
(OpenBMB, Apache 2.0). Text-to-speech с voice cloning по reference WAV, 48kHz,
30 языков, ~8 GB VRAM.

## Контракт

Вход (`job["input"]`):

```jsonc
{
  "text": "Привет, это синтез речи.", // обязательный
  "referenceAudioUrl": "https://.../voice.wav", // voice cloning (опц.)
  "referenceText": "транскрипт reference",       // улучшает клон (опц.)
  "style": "warm, calm female voice in her 30s",  // voice-design тег (опц.)
  "cfgValue": 2.0,            // CFG (опц., default 2.0)
  "inferenceTimesteps": 10,   // diffusion шаги (опц., default 10)
  "normalize": true           // текстовая нормализация (опц.)
}
```

Выход:

```jsonc
{ "audio": [{ "filename": "voxcpm-xxx.wav", "type": "s3_url", "data": "https://..." }] }
```

При `BUCKET_ENDPOINT_URL` результат заливается в S3 (`type: "s3_url"`), иначе
возвращается base64 (`type: "base64"`).

## Build & push

```bash
docker buildx build --platform linux/amd64 \
  -t <docker-hub-user>/worker-tts-voxcpm:v1 \
  -f packages/runpod/docker/worker-tts-voxcpm/Dockerfile \
  packages/runpod/docker/worker-tts-voxcpm
docker push <docker-hub-user>/worker-tts-voxcpm:v1
```

## Seed моделей на volume

Веса не baked в образ. Pre-seed HF cache на `voxcpm-*` network volume:

```bash
RUNPOD_API_KEY=rpa_xxx HF_TOKEN=hf_xxx \
  bun run packages/runpod/scripts/seed-voxcpm-models.ts
```

Worker читает кеш из `HF_HOME=/runpod-volume/hf-cache`.

## Provision endpoint

```bash
RUNPOD_API_KEY=rpa_xxx \
RUNPOD_VOXCPM_TTS_SERVERLESS_IMAGE=<hub>/worker-tts-voxcpm:v1 \
  bun run packages/runpod/scripts/create-tts-serverless-endpoints.ts
```

Затем выставить `RUNPOD_VOXCPM_TTS_ENDPOINT_ID` для generator (env-default) или
зарегистрировать template в admin DB (`workflowKey: "tts-voxcpm"`).

## Smoke

```bash
RUNPOD_API_KEY=rpa_xxx RUNPOD_VOXCPM_TTS_ENDPOINT_ID=<id> \
  bun run packages/runpod/scripts/smoke-tts-serverless.ts
```
