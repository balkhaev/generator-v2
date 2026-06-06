# Debugging Toolchain

Цель: дать один воспроизводимый контур дебага для `provider -> generator-api -> admin-api -> studio/persons -> output artifacts`, чтобы агент мог дойти от симптома до корня без ручного перебора.

Контур построен на двух слоях MCP, и система должна сама себя дебажить через них:

- **Project MCP** (`apps/mcp` HTTP + `packages/debug-tools` stdio) — «как должно быть»: контракты, локальный репро, test users, Kafka, execution sync.
- **Coolify MCP** (`user-balkhaev-coolify`) — «что реально крутится в проде»: апы, контейнеры, логи (`application_logs`, `deployment` logs), env, restart/redeploy.

Self-debug loop: `coolify.find_issues` → `coolify.diagnose_app` / `application_logs` → `project.service_request` для репро → фикс кода/env → `coolify.deploy` или `coolify.env_vars` + `control` → повторная проверка `application_logs` + `find_issues` + `service_health`. Подробно — в скиле `.agents/skills/mcp-debug/SKILL.md`.

## Уже есть в репо

Сильные стороны текущей базы:

- `apps/generator/src/providers/replicate.ts`
  Клиент для Replicate inference.
- `packages/debug-tools`
  Пакет для сбора debug bundles и MCP-тулы для диагностики.

## Debug Package

`packages/debug-tools`

Команды:

```bash
bun --cwd packages/debug-tools run bundle
bun --cwd packages/debug-tools run bundle --include-dashboard --include-studio-snapshot
bun --cwd packages/debug-tools run mcp
```

Что делает `bundle`:

- проверяет health локальных сервисов
- опционально тянет admin dashboard snapshot
- опционально тянет studio snapshot
- сохраняет всё в `.artifacts/debug-bundles/<timestamp>/`

## Repo-local MCP

В репо два MCP-сервера. Агент обязан использовать тулы оттуда вместо разовых curl/psql/kafkacat. Если нужного нет — добавить в MCP, см. скил `mcp-debug` (`.agents/skills/mcp-debug/SKILL.md`).

### `apps/mcp` — HTTP MCP (основной, prod-style)

Транспорт: HTTP JSON-RPC, `POST /mcp`, bearer `MCP_AUTH_TOKEN`, порт `PORT` (по умолчанию `3010`). Health: `GET /api/health`. Точка входа: `apps/mcp/src/index.ts`, регистрация тулов: `apps/mcp/src/app.ts`.

Тулы:

- workspace/health: `workspace_summary`, `service_health`, `service_request`
- admin queue: `admin_lora_training_queue_snapshot`
- generator: `generator_workflows_get`, `generator_execution_submit`, `generator_execution_sync`
- persons: `persons_list`, `persons_get`, `persons_retrain_lora`, `persons_reupload_adorely_assets`, `persons_lora_generation_debug`
- studio: `studio_execution_debug`, `studio_run_mark_failed`, `studio_scenario_update`
- admin settings: `admin_settings_get`, `training_provider_get`, `training_provider_set`, `admin_request`
- prompt enhance: `prompt_enhance_get`, `prompt_enhance_set` (провайдер + модель studio/persons "Enhance" / "Enhance for image"; пишет Redis + runtime-config + инвалидация)
- test users: `test_user_upsert`, `test_user_get`
- kafka: `kafka_cluster_info`, `kafka_topics_list`, `kafka_topic_offsets`, `kafka_consumer_groups_list`, `kafka_consumer_group_describe`, `kafka_topic_sample`
- runpod serverless: `runpod_serverless_health`, `runpod_serverless_status`, `runpod_serverless_cancel`, `runpod_serverless_requests`, `runpod_serverless_purge_queue`, `runpod_serverless_run`, `runpod_endpoint_get`, `runpod_endpoint_patch`, `runpod_template_get`, `runpod_template_patch`

#### NSFW prompt-enhance (studio "Enhance for image")

Симптом: в студии `Enhance` / `Enhance for image` отказывается переписывать NSFW-бриф или выдаёт слабый промпт.

1. `prompt_enhance_get { target: "studio" }` — посмотреть текущий `provider` / `openRouterModel`. Если `provider: openrouter` и модель из семейства Qwen или `openai/gpt-4o-mini` — она почти всегда морализирует/отказывает на explicit-брифах, а vision-ветка падает в text-fallback.
2. `prompt_enhance_set { target: "studio", provider: "openrouter", openRouterModel: "x-ai/grok-4.20" }` — валидированная permissive vision-модель: грундит промпт по input-кадру, различает статичный/экшн-бриф, не отказывает, уважает `reasoning: { enabled: false }`. Один вызов пишет Redis + runtime-config store и инвалидирует кэш консьюмеров.
3. Проверить end-to-end: `service_request` на studio `/api/enhance-prompt` с `imageUrl` (vision-режим), убедиться что `mode: "vision"` и `notice: null` (не сорвалось в text-fallback).

### `packages/debug-tools` — stdio MCP + bundle CLI

`packages/debug-tools/src/mcp-server.ts`

Тулы:

- `workspace_summary`
- `service_health`
- `admin_dashboard_get`
- `studio_snapshot_get`
- `generator_workflows_get`
- `generator_execution_submit`
- `generator_execution_sync`
- `collect_debug_bundle`

## Корреляция execution trace

В репо добавлен единый `x-debug-correlation-id`, который сервисы принимают или генерируют автоматически и прокидывают дальше в downstream вызовы.

Текущий путь:

- входящий HTTP request в `admin`, `studio`, `generator`, `persons`
- internal proxy hops `admin -> studio`, `studio -> generator`
- server-side execution clients

Для ручного прогона можно передавать header самому:

```bash
curl -H 'x-debug-correlation-id: dbg-manual-123' http://localhost:3005/api/health
```

## Минимальный operating mode

Для быстрой диагностики достаточно такого порядка:

1. `bun --cwd packages/debug-tools run bundle`
2. если проблема похожа на auth / admin / studio path:
   `bun --cwd packages/debug-tools run bundle --include-dashboard --include-studio-snapshot`
3. если нужен tool-driven режим для агента:
   `bun --cwd packages/debug-tools run mcp`

## RunPod smoke probes

Минимальные пробы для отладки RunPod-инференса (serverless и pod) живут в
[packages/runpod/scripts](../packages/runpod/scripts) и работают напрямую через
`@generator/runpod`, без БД и worker'а. Полезно как self-debug step, когда
непонятно, виноват провайдер, наш payload, или сам workflow.

```bash
# Serverless: реальный submit/poll/cancel минимального Fooocus-prompt
RUNPOD_API_KEY=rpa_xxx \
RUNPOD_FOOOCUS_ENDPOINT_ID=xxxxxx \
bun run packages/runpod/scripts/smoke-serverless.ts -- --prompt="cat"

# Pod: dry-run валидирует input и собирает API graph без вызова RunPod
S3_BUCKET=... S3_ENDPOINT=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
RUNPOD_API_KEY=rpa_xxx \
RUNPOD_LTX23_POD_TEMPLATE_ID=p4f6rm9tb4 \
bun run packages/runpod/scripts/smoke-pod.ts -- --dry-run --prompt="cat"

# Pod: live поднимает реальный pod LTX 2.3 (template-driven), ждёт MP4 в S3
bun run packages/runpod/scripts/smoke-pod.ts -- --live --prompt="cat"
```

Скрипты печатают таймлайн (`smoke.start`, `smoke.submitted`, `smoke.poll`,
`smoke.success | smoke.failed | smoke.timeout`), что удобно складывать в
debug-bundle при инцидентах. Если live-проба зависла — Ctrl-C, скрипт
best-effort удалит pod через тот же engine.

## Внешние источники

- Replicate API docs: <https://replicate.com/docs/reference/http>
- MCP official docs: <https://modelcontextprotocol.io/introduction>

## Adorely Import

Импорт Adorely companions в `persons` идёт через read-only Adorely Debug MCP
(`list_companions`, `get_companion`, `list_companion_assets`) и CLI
`bun run --cwd apps/persons import:adorely`. Подробности и режимы dry-run/apply:
`docs/adorely-import.md`.

`persons_reupload_adorely_assets` чинит импортированных Adorely-persons, у
которых в `referencePhotoUrl` или dataset rows остались ссылки на чужой закрытый
bucket. Tool берёт актуальные assets из read-only Adorely Debug MCP, загружает их
в storage `persons-api` и обновляет person/dataset URL. По умолчанию dry-run;
для записи нужно явно передать `apply: true`.

`persons_lora_generation_debug` — read-only tool для разбора жалоб
«генерация без LoRA»: принимает `personId` или `personSlug`, опционально
`generationId`/`executionId`, читает person/generation/generator execution
записи из БД и возвращает проверки `params.loraUrl`, совпадения с `person.loraUrl`,
trigger word в prompt и summary provider payload (`__falModel`, `loras`).

`studio_execution_debug` — read-only tool для разбора Studio launch/run
инцидентов: принимает `scenarioId`, `runId`, `executionId` или `providerJobId`,
читает Studio scenario/run и generator execution записи из БД, строит summary
provider payload и мапит LoRA URL из params/`body.loras` на registry entries с
проверкой лимита fal.ai `1GB`.
