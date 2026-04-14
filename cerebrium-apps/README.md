# Cerebrium Apps

Python-приложения для деплоя на [Cerebrium](https://cerebrium.ai/) serverless GPU.

## Приложения

### `inference/`
Универсальный inference-сервис (text-to-image, img2img) с поддержкой Z-Image, ZIB-DPO, Flux моделей и LoRA weights.

- **GPU**: L40 (48GB VRAM)
- **Функции**: `generate(...)`, `img2img(...)`, `prepare_for_training()`, `storage_info()`, `clear_cache()`
- **Ответ**: `{ images: [{ url: "..." }] }`

### `lora-training/`
Обучение LoRA адаптеров на Z-Image base.

- **GPU**: L40 (48GB VRAM)
- **Функция**: `train(dataset_url, steps, trigger_word, ...)`
- **Статус**: `get_training_status(job_id)`

## Деплой

```bash
pip install cerebrium
cerebrium login

# Деплой инференса
cd inference
cerebrium deploy

# Деплой обучения
cd ../lora-training
cerebrium deploy
```

## Как работает интеграция

```
[TypeScript services]          [Cerebrium GPU]
      |                              |
      |-- POST /inference/generate ----->  Image generation
      |<-- { images: [...] } ----------|
      |                              |
      |-- POST /inference/img2img ------>  Img2img for dataset
      |<-- { images: [...] } ----------|
      |                              |
      |-- POST /lora-training/train ---->  LoRA training
      |-- POST /lora-training/get_training_status -> Poll
      |<-- { status, lora_url } -------|
```

1. Generator/Admin services (TypeScript) отправляют HTTP-запросы к Cerebrium
2. Cerebrium автоматически поднимает GPU-контейнер
3. Функция выполняется и возвращает результат
4. Контейнер автоматически выключается после `cooldown` периода
