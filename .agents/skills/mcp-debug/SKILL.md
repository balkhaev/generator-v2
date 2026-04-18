---
name: mcp-debug
description: Self-debug loop через два слоя MCP — project (apps/mcp + packages/debug-tools) и Coolify (prod). Используй MCP вместо ad-hoc curl/psql/ssh, а при нехватке тулов сначала расширяй MCP, потом дебагай. Trigger когда упоминают debugging, прод упал, MCP, Coolify, redeploy, inference failures, broken APIs, Kafka, test users, или нужна кросс-сервисная диагностика.
---

# MCP Debug Skill

Система должна **сама себя дебажить через MCP**. У агента есть два слоя инструментов; разовые `curl`, `psql`, `ssh`, `docker logs` запрещены, пока не доказано, что нужного MCP-tool не существует и не может быть добавлен.

## Два слоя MCP

| Слой | Сервер | Что отвечает | Куда смотреть |
|------|--------|--------------|---------------|
| **Project** | `apps/mcp` (HTTP, `:3010`, bearer) + `packages/debug-tools` (stdio) | Своя бизнес-логика: health, `service_request`, generator workflows / executions, test users, локальная Kafka, debug-bundles | `apps/mcp/src/app.ts`, `packages/debug-tools/src/mcp-server.ts` |
| **Prod / infra** | Coolify MCP (`user-balkhaev-coolify`) | Прод: апы, контейнеры, env, логи приложений и деплойментов, restart/redeploy, серверы | `list_applications`, `get_application`, `application_logs`, `diagnose_app`, `diagnose_server`, `deployment`, `deploy`, `redeploy_project`, `restart_project_apps`, `control`, `env_vars`, `bulk_env_update`, `find_issues`, `get_infrastructure_overview`, `server_resources` |

Project MCP знает «как должно быть». Coolify MCP знает «что реально крутится». Дебаг — это сведение этих двух картин.

## Правило одной двери

1. Сначала смотри, есть ли подходящий MCP-tool в нужном слое.
2. Если есть — вызывай.
3. Если нет — **сначала добавь tool** (project MCP — в `apps/mcp/src/app.ts` по инструкции ниже; coolify — обёрточный tool в `apps/mcp`, который ходит в Coolify API), потом дебагай.
4. Никаких одноразовых bash-цепочек, если задача повторяется или нужна другому агенту.

## Self-Debug Loop

Канонический цикл, который агент должен прогонять без ручных шагов оператора.

### 0. Триггер

Жалоба «упал прод», «5xx у юзера X», «инференс не возвращает артефакт», или ручная просьба «проверь, что всё ок».

### 1. Снять состояние прода (Coolify MCP)

- `find_issues` — глобальный скан проблем. Это первая команда при любом неясном инциденте.
- `get_infrastructure_overview` — счётчики по ресурсам, чтобы понять, упал один контейнер или весь сервер.
- Если жалоба на конкретный сервис (admin / generator / studio / persons / mcp): `diagnose_app` с `query` = именем/доменом, потом `application_logs` с нужным `uuid` и `lines: 500` (или больше для редких ошибок).
- Если подозрение на сервер: `diagnose_server`, `server_resources`.
- Если подозрение на провалившийся деплой: `deployment` с `action: "list_for_app"` → берёшь свежий uuid → `deployment` с `action: "get"` и `lines` для логов сборки.
- Если симптом редкий и в свежих логах не видно — увеличивай `lines` и/или смотри `application_logs` смежных сервисов в цепочке (`admin → studio → generator → persons`).

К этому моменту у тебя должно быть: какой сервис, какой `uuid`, какой класс ошибки, в какое окно времени, был ли свежий деплой.

### 2. Сравнить с «как должно быть» (Project MCP)

- `service_health` (project MCP) против локального dev-стека — поведение совпадает или ломается только в проде?
- `service_request` — повторить тот же путь запроса (с `x-debug-correlation-id`) локально.
- Для inference: `generator_workflows_get` (проверить, что workflow вообще существует и валидируется), `generator_execution_submit` с теми же params, что в проде.
- Для auth-проблем: `test_user_upsert` создаёт валидного юзера, `test_user_get` достаёт сессии.
- Для шины: `kafka_topics_list`, `kafka_consumer_group_describe` (lag по консьюмеру, который виновен), `kafka_topic_sample` чтобы посмотреть формат сообщений.

Цель шага — **локально воспроизвести** или **локально опровергнуть** прод-симптом.

### 3. Развести причину

Три типичных исхода:

1. **Локально воспроизводится** → баг в коде/контракте. Идём в шаг 4 (фикс + деплой).
2. **Локально не воспроизводится, но прод-логи однозначные** → среда. Сверь env: Coolify `env_vars` (`action: "list"`) против локального `.env` / `apps/<svc>/.env`. Если расхождение — `env_vars` `update` или `bulk_env_update`.
3. **Локально не воспроизводится, логи мутные** → инфраструктура: `diagnose_server`, ресурсы (`server_resources`), статус смежных сервисов (`list_databases`, `list_services`), последние деплои (`list_deployments`).

### 4. Применить фикс

- Код фикса → коммит → PR. После мержа:
  - `deploy` (`tag_or_uuid` = uuid апа или тег коммита, `force: true` если нужно перебить кэш).
  - Для composite-проекта: `redeploy_project` или `restart_project_apps` если нужен только рестарт без пересборки.
- Если фикс — env: `env_vars` или `bulk_env_update`, потом `control` `restart` или `deploy` (зависит от того, читается ли env только при старте контейнера).

### 5. Подтвердить, что починилось

Тот же набор проверок, что и в шаге 1, но после фикса:

- `application_logs` с `lines: 200` после рестарта — нет ли тех же ошибок (грепай по тому же паттерну, что был исходно).
- `deployment action: "get"` для свежего деплоя — статус `finished`, без ошибок сборки.
- `service_health` через project MCP — все зелёные.
- `find_issues` повторно — исчезла ли запись по нашему сервису.

Цикл считается замкнутым, только когда шаг 5 даёт зелёное состояние и причина зафиксирована (PR / комментарий в issue).

### 6. Закрепить (если повторится)

- Если симптом редкий и его искали через bash — добавь tool в `apps/mcp`, чтобы следующий агент нашёл за один вызов.
- Если симптом был «локально не воспроизводился» — добавь повторяющийся шаг в project MCP, чтобы env-diff / проверка проходили автоматически.
- Если шаг 1 потребовал руками склеивать `application_logs` нескольких сервисов в окне инцидента — оформи это как обёрточный composite tool в `apps/mcp` (например, `coolify_logs_around_deploy`).

## Когда какой MCP

- «Что-то с продом, я не знаю, что» → **Coolify** (`find_issues` → `diagnose_app` → `application_logs`).
- «Хочу повторить запрос / проверить контракт» → **Project** (`service_request`, `generator_*`, `test_user_*`, `kafka_*`).
- «Надо изменить состояние прода» (рестарт, деплой, env) → **Coolify** (`control`, `deploy`, `env_vars`, `bulk_env_update`).
- «Надо собрать снапшот для отчёта» → `packages/debug-tools` `bundle` + ссылки на Coolify-апы.

## Коротко, что вызывать первым

```text
прод упал           → coolify.find_issues             → coolify.application_logs
5xx у конкретного   → coolify.diagnose_app            → coolify.application_logs (lines: 500)
сборка не проходит  → coolify.deployment list_for_app → deployment get (lines)
inference плохо     → project.generator_workflows_get → project.generator_execution_submit
auth/сессии         → project.test_user_upsert        → project.service_request
kafka лаг           → project.kafka_consumer_group_describe
env подозрителен    → coolify.env_vars list           → diff с локальным .env
не пойму, что       → coolify.get_infrastructure_overview + project.service_health
```

## Реестр MCP-тулов в репо

### 1. `apps/mcp` — HTTP MCP (основной)

- Транспорт: HTTP JSON-RPC, `POST /mcp`, bearer auth (`MCP_AUTH_TOKEN`).
- Порт: `PORT` (по умолчанию `3010`).
- Точка входа: `apps/mcp/src/index.ts`, тулы — `apps/mcp/src/app.ts`.
- Health: `GET http://localhost:3010/api/health`.

Группы тулов:
- workspace / health: `workspace_summary`, `service_health`, `service_request`
- generator: `generator_workflows_get`, `generator_execution_submit`, `generator_execution_sync`
- test users: `test_user_upsert`, `test_user_get`
- kafka: `kafka_cluster_info`, `kafka_topics_list`, `kafka_topic_offsets`, `kafka_consumer_groups_list`, `kafka_consumer_group_describe`, `kafka_topic_sample`

### 2. `packages/debug-tools` — stdio MCP + bundle CLI

- Транспорт: stdio JSON-RPC (`bun --cwd packages/debug-tools run mcp`).
- Дополнительно умеет собирать debug-bundle на диск:

```bash
bun --cwd packages/debug-tools run bundle
bun --cwd packages/debug-tools run bundle --include-dashboard --include-studio-snapshot
```

Тулы: `workspace_summary`, `service_health`, `admin_dashboard_get`, `studio_snapshot_get`, `generator_workflows_get`, `generator_execution_submit`, `generator_execution_sync`, `collect_debug_bundle`.

Bundle складывается в `.artifacts/debug-bundles/<timestamp>/`.

## Когда расширять MCP

Расширяй MCP, если выполнено хотя бы одно:
- понадобится >1 раза (даже разным агентам);
- требует доступ к секретам/инфраструктуре, которые уже есть в окружении MCP-сервиса (DB, Kafka, провайдеры);
- сейчас «решается» bash-скриптом длиннее ~10 строк;
- нужно отдать структурированный JSON следующему шагу пайплайна.

Если это правда «один раз и забыть» (например, прочитать localhost-страницу) — допустим прямой инструмент IDE.

## Как добавить новый tool в `apps/mcp`

Шаги (порядок важен — иначе TS не соберётся):

1. **Описать схему** в массиве `toolDefinitions` (`apps/mcp/src/app.ts`):
   - уникальное `name` в snake_case с префиксом домена (`kafka_*`, `generator_*`, `studio_*`, …);
   - `description` — одно предложение, что возвращает;
   - `inputSchema` — JSON Schema с обязательными полями в `required`.
2. **Добавить хендлер.** Если домен новый — заведи функцию `handleXxxToolCall` по образцу `handleKafkaToolCall`. Если домен существующий — допиши `case` в нужном `switch`.
3. **Парсинг входа** — только через хелперы `parseOptionalString`, `parseOptionalNumber`, `parseOptionalBoolean`, `parseStringArray`, `parseHeaders`. Не доверяй типам из `argumentsPayload` напрямую.
4. **Ошибки** — внешние сбои оборачивай в `createToolResult({ error, tool: name }, true)` (структурированный isError), валидационные ошибки входа — `createErrorResponse(id, "...")`.
5. **Сетевые вызовы наружу** — через `fetchServiceSnapshot`/`postJson` (для своих сервисов) или прямой клиент (Kafka и т.п.) обёрнутый в helper типа `withKafkaAdmin`. Никогда не оставляй открытые соединения — disconnect в `finally`.
6. **Test.** Добавь кейс в `apps/mcp/src/app.test.ts`:
   - tool появляется в `tools/list`;
   - `tools/call` с минимальным валидным payload отвечает `result.structuredContent`;
   - невалидный payload даёт читаемую ошибку.
7. **Lint/format.** `bun x ultracite fix`.
8. **Type-check + test.** `bun --cwd apps/mcp run check-types && bun test apps/mcp`.
9. Если ту же возможность хочется и в локальном bundle/stdio MCP — продублируй в `packages/debug-tools/src/mcp-server.ts` (там та же структура `toolDefinitions` + `toolHandlers`).
10. Обнови `docs/debugging-toolchain.md`: добавь новый tool в соответствующий список.

## Как добавить tool в `packages/debug-tools`

Тот же порядок, но проще: один файл `src/mcp-server.ts`, хендлер регистрируется в `toolHandlers`. Тестов на сейчас нет — допускается добавить минимальный smoke-тест рядом.

## Чего не хватает в Coolify MCP

Coolify MCP — внешний, его код мы не редактируем. Если нужного действия там нет, варианты:

1. **Обёрточный tool в `apps/mcp`.** Завести в `apps/mcp/src/app.ts` домен `coolify_*`, который ходит в Coolify API (`COOLIFY_API_URL` + token) и возвращает уже агрегированный ответ под наш сценарий. Это правильный путь, когда нужна композиция — например, «дай логи прод-апа `generator` за окно ±5 минут от последнего деплоя» — это два внешних запроса + склейка.
2. **Composite tool в project MCP.** Если нужно совместить прод-наблюдение и локальный репро (например, «возьми последние N ошибок 5xx из `application_logs`, повтори те же запросы через `service_request` локально, верни diff») — это tool в `apps/mcp`, который внутри дёргает Coolify API и `fetchServiceSnapshot` через `@generator/debug-tools/shared`.
3. **Если действие правда отсутствует в самом Coolify** — обходим через его HTTP API в нашем обёрточном tool.

Никогда не подменяй вызов Coolify MCP прямым `curl https://coolify…` без оборачивания в наш tool — это ломает self-debug loop для следующего агента.

## Запуск MCP локально для проверки

```bash
MCP_AUTH_TOKEN=dev bun --cwd apps/mcp run dev
```

Smoke:

```bash
curl -s http://localhost:3010/api/health
curl -s -X POST http://localhost:3010/mcp \
  -H "authorization: Bearer dev" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```

Stdio MCP:

```bash
bun --cwd packages/debug-tools run mcp
```

## Анти-паттерны

- Решать дебаг разовым `curl` или `psql` без проверки, есть ли тул в MCP.
- Дёргать прод напрямую (`ssh`, прямой `docker logs`, `coolify-cli`), когда есть Coolify MCP.
- Перезапускать прод вручную, когда есть `control` / `restart_project_apps`.
- Менять прод-env «через панельку», когда нужны воспроизводимые `env_vars` / `bulk_env_update` (без них следующий агент не узнает, что было сделано).
- Деплоить руками, когда есть `deploy` / `redeploy_project` (тогда нет связи с инцидентом и историей).
- Добавлять tool без схемы `inputSchema` или без `required`.
- Возвращать «голый» текст — все ответы должны идти через `createToolResult`, чтобы был `structuredContent`.
- Делать tool с побочкой (создаёт прод-данные, шлёт реальные платежи и т.п.) без явного защитного флага.
- Дублировать одну логику между `apps/mcp` и `packages/debug-tools` копипастой — общие хелперы держим в `@generator/debug-tools/shared`.
- Останавливать self-debug loop после фикса без шага 5 (подтверждение, что прод действительно зелёный).

## Связанные скилы

- `backend-debug` — рутинная диагностика admin/generator/studio/persons.
- `inference-debug` — путь от workflow до артефакта.

Эти скилы используют ту же базу — если им чего-то не хватает, расширяется именно MCP, а скилы лишь ссылаются на новые тулы.
