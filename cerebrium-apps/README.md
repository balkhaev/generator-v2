# Cerebrium Apps

Python-приложения для деплоя на [Cerebrium](https://cerebrium.ai/) serverless GPU.

## Приложения

### `flux-inference/`
Инференс Flux.1-dev (text-to-image) с поддержкой LoRA weights.

- **GPU**: A10 (24GB VRAM)
- **Функция**: `generate(prompt, width, height, lora_url?, ...)`
- **Ответ**: `{ images: [{ url: "..." }] }`

### `lora-training/`
Обучение LoRA адаптеров на Flux.1-dev.

- **GPU**: A100 80GB
- **Функция**: `train(dataset_url, steps, trigger_word, ...)`
- **Ответ**: `{ lora_url: "...", steps, trigger_word }`

## Деплой

```bash
pip install cerebrium
cerebrium login

# Деплой инференса
cd flux-inference
cerebrium deploy

# Деплой обучения
cd ../lora-training
cerebrium deploy
```

## Необходимые секреты на Cerebrium

В Dashboard → Secrets или через CLI:

- `CEREBRIUM_PUBLIC_STORAGE_URL` — публичный URL для persistent storage
  (например `https://your-cdn.com/storage`)
- `FLUX_MODEL_ID` — (опционально) кастомный путь к модели
  (по умолчанию `black-forest-labs/FLUX.1-dev`)

## Как работает интеграция

```
[TypeScript services]          [Cerebrium GPU]
      |                              |
      |-- POST /flux-inference/generate -->  Flux inference
      |<-- { images: [...] } ---------|
      |                              |
      |-- POST /lora-training/train -->  LoRA training
      |<-- { lora_url: "..." } ------|
```

1. Generator service (TypeScript) отправляет HTTP-запросы к Cerebrium
2. Cerebrium автоматически поднимает GPU-контейнер (cold start ~2-4с)
3. Функция выполняется и возвращает результат
4. Контейнер автоматически выключается после `cooldown` периода
