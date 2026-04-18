# Debugging Toolchain

Цель: дать один воспроизводимый контур дебага для `provider -> generator-api -> admin-api -> studio/persons -> output artifacts`, чтобы агент мог дойти от симптома до корня без ручного перебора.

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
- generator: `generator_workflows_get`, `generator_execution_submit`, `generator_execution_sync`
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
