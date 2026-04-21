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
- persons: `persons_list`, `persons_get`, `persons_retrain_lora`, `persons_reupload_adorely_assets`
- test users: `test_user_upsert`, `test_user_get`
- kafka: `kafka_cluster_info`, `kafka_topics_list`, `kafka_topic_offsets`, `kafka_consumer_groups_list`, `kafka_consumer_group_describe`, `kafka_topic_sample`

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
