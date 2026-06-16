# Концепция: generator-v2 в продукте

> Роль этого репозитория в общей экосистеме AI-контента. Канонический документ
> продукта и сквозного флоу живёт в hub: `hub/docs/CONCEPT.md`.

## Что это

**generator-v2 — движок производства медиа.** Это AI-генерация изображений/видео
по воркфлоу с участием обученных персон (LoRA). В терминах продукта это слой
**«как произвести»**: получив задание (какую персону и по какому сценарию
сгенерировать), он прогоняет inference и отдаёт готовые артефакты.

## Место в экосистеме

```
mediator (что/когда)  ──►  hub (оркестрация)  ──►  generator-v2 (как произвести)
                                                          │ артефакты (callback)
                                                          ▼
                                                   Luv Club (где живёт контент)
```

- **Вход:** запрос на генерацию от **hub** (тренд → execution) — выбор
  воркфлоу/персоны и параметров.
- **Личности:** персоны импортируются из **Luv Club** (исторически — Adorely,
  см. `docs/adorely-import.md`) в домен `persons` как Cast, затем тренируется
  LoRA на датасете.
- **Выход:** готовое медиа + статус через **callback в hub**, откуда оно идёт в
  Luv Club как контент компаньона.

## Bounded contexts (см. `docs/target-architecture.md`)

| Контекст        | Ответственность                                              |
| --------------- | ----------------------------------------------------------- |
| `generator-api` | Stateless execution engine: принять команду, поставить в очередь, вызвать inference-провайдер (RunPod / Replicate / Fal), хранить execution до terminal-статуса |
| `studio-api`    | Studio-домен: сценарии и runs                               |
| `persons-api`   | Персоны/Cast: личности, датасеты, LoRA-тренинг              |
| `admin-api`     | Control plane: auth, topology, admin-воркфлоу               |
| `*-web`         | UI-слои (admin / studio / persons)                          |
| `mcp`           | Self-debug и автоматизация через MCP                        |

Главное правило: **`generator-api` не владеет бизнес-сущностями продукта** —
персоны, сценарии, подписки и т.п. живут в своих доменах/продукте, а движок
держит только технические execution-записи.

## Контракт с hub

- `POST /api/executions` (+ `…/sync`) — запуск генерации; payload содержит
  `workflowKey`, `prompt`, `params`, `inputImageUrl` и `callback` (url + token +
  context с `runId`).
- `GET /api/executions/:id` — статус.
- По завершении — `POST {callback.url}` с `{ context, execution }` и заголовком
  `x-generator-callback-token`; hub закрывает соответствующую сагу.
- `GET /api/health` — публичный liveness для агрегированного health hub.
