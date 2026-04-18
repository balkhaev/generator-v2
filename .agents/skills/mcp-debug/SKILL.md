---
name: mcp-debug
description: Self-debug loop через три слоя MCP — project (apps/mcp + packages/debug-tools), Coolify (prod), Grafana (метрики/Loki). Используй MCP вместо ad-hoc curl/psql/ssh, а при нехватке тулов сначала расширяй MCP, потом дебагай. Trigger когда упоминают debugging, прод упал, MCP, Coolify, redeploy, Grafana, inference failures, broken APIs, Kafka, test users, или нужна кросс-сервисная диагностика.
---

# MCP Debug Skill

Система должна **сама себя дебажить через MCP**. У агента есть три слоя инструментов; разовые `curl`, `psql`, `ssh`, `docker logs` запрещены, пока не доказано, что нужного MCP-tool не существует и не может быть добавлен.

## Три слоя MCP

| Слой | Сервер | Что отвечает | Куда смотреть |
|------|--------|--------------|---------------|
| **Project** | `apps/mcp` (HTTP, `:3010`, bearer) + `packages/debug-tools` (stdio) | Своя бизнес-логика: health, `service_request`, generator workflows / executions, test users, локальная Kafka, debug-bundles | `apps/mcp/src/app.ts`, `packages/debug-tools/src/mcp-server.ts` |
| **Prod / infra** | Coolify MCP (`user-balkhaev-coolify`) | Прод: апы, контейнеры, env, логи приложений и деплойментов, restart/redeploy, серверы | тулы `list_applications`, `get_application`, `application_logs`, `diagnose_app`, `diagnose_server`, `deployment`, `deploy`, `redeploy_project`, `restart_project_apps`, `control`, `env_vars`, `bulk_env_update`, `find_issues`, `get_infrastructure_overview`, `server_resources` |
| **Observability** | Grafana MCP (`user-grafana`) | Метрики, Loki-логи прода, alert rules, on-call, Sift/Pyroscope | `query_loki_logs`, `find_error_pattern_logs`, `find_slow_requests`, Prometheus list/query, alerts, on-call, Sift |

Project MCP знает «как должно быть». Coolify MCP знает «что реально крутится». Grafana знает «что наблюдалось во времени». Дебаг — это сведение этих трёх картин.

## Правило одной двери

1. Сначала смотри, есть ли подходящий MCP-tool в нужном слое.
2. Если есть — вызывай.
3. Если нет — **сначала добавь tool** (project MCP — в `apps/mcp/src/app.ts` по инструкции ниже; coolify/grafana — открой issue или extend через свой обёрточный tool в `apps/mcp`, который ходит в их API), потом дебагай.
4. Никаких одноразовых bash-цепочек, если задача повторяется или нужна другому агенту.

## Self-Debug Loop

Канонический цикл, который агент должен прогонять без ручных шагов оператора.

### 0. Триггер

Жалоба «упал прод», «5xx у юзера X», «инференс не возвращает артефакт», алерт из Grafana, или ручная просьба «проверь, что всё ок».

### 1. Снять состояние прода (Coolify MCP)

- `find_issues` — глобальный скан проблем. Это первая команда при любом неясном инциденте.
- `get_infrastructure_overview` — счётчики по ресурсам, чтобы понять, упал один контейнер или весь сервер.
- Если жалоба на конкретный сервис (admin / generator / studio / persons / mcp): `diagnose_app` с `query` = именем/доменом, потом `application_logs` с нужным `uuid` и `lines: 500` (или больше для редких ошибок).
- Если подозрение на сервер: `diagnose_server`, `server_resources`.
- Если подозрение на провалившийся деплой: `deployment` с `action: "list_for_app"` → берёшь свежий uuid → `deployment` с `action: "get"` и `lines` для логов сборки.

### 2. Подтвердить наблюдением (Grafana MCP)

Логи Coolify — это «здесь и сейчас». Чтобы понять историю и масштаб:

- `query_loki_logs` / `find_error_pattern_logs` по сервису + временное окно вокруг инцидента.
- `find_slow_requests` если симптом — таймауты/латенси, а не явный 5xx.
- `list_alert_rules` + последний `get_alert_rule_by_uid`, чтобы понять, что уже сработало.
- `list_incidents` — нет ли уже созданного инцидента (тогда добавляй активность через `add_activity_to_incident`, не плоди дубль).

К этому моменту у тебя должно быть: какой сервис, какой `uuid`, какой класс ошибки, в какое окно времени, был ли свежий деплой.

### 3. Сравнить с «как должно быть» (Project MCP)

- `service_health` (project MCP) против локального dev-стека — поведение совпадает или ломается только в проде?
- `service_request` — повторить тот же путь запроса (с `x-debug-correlation-id`) локально.
- Для inference: `generator_workflows_get` (проверить, что workflow вообще существует и валидируется), `generator_execution_submit` с теми же params, что в проде.
- Для auth-проблем: `test_user_upsert` создаёт валидного юзера, `test_user_get` достаёт сессии.
- Для шины: `kafka_topics_list`, `kafka_consumer_group_describe` (lag по консьюмеру, который виновен), `kafka_topic_sample` чтобы посмотреть формат сообщений.

Цель шага — **локально воспроизвести** или **локально опровергнуть** прод-симптом.

### 4. Развести причину

Три типичных исхода:

1. **Локально воспроизводится** → баг в коде/контракте. Идём в шаг 5 (фикс + деплой).
2. **Локально не воспроизводится, но прод-логи однозначные** → среда. Сверь env: Coolify `env_vars` (`action: "list"`) против локального `.env` / `apps/<svc>/.env`. Если расхождение — `env_vars` `update` или `bulk_env_update`.
3. **Локально не воспроизводится, логи мутные** → инфраструктура: `diagnose_server`, ресурсы (`server_resources`), статус смежных сервисов (`list_databases`, `list_services`), последние деплои (`list_deployments`).

### 5. Применить фикс

- Код фикса → коммит → PR. После мержа:
  - `deploy` (`tag_or_uuid` = uuid апа или тег коммита, `force: true` если нужно перебить кэш).
  - Для composite-проекта: `redeploy_project` или `restart_project_apps` если нужен только рестарт без пересборки.
- Если фикс — env: `env_vars` или `bulk_env_update`, потом `control` `restart` или `deploy` (зависит от того, читается ли env только при старте контейнера).

### 6. Подтвердить, что починилось

Тот же набор проверок, что и в шагах 1–2, но после фикса:

- `application_logs` с `lines: 200` после рестарта — нет ли тех же ошибок.
- `service_health` через project MCP — все зелёные.
- `query_loki_logs` за окно последних 5 минут — паттерн ошибок исчез.
- Если был алерт — проверь, что он закрылся (`list_alert_rules`).
- Если был `create_incident` — закрой через `add_activity_to_incident` с резолюшеном.

Цикл считается замкнутым, только когда шаг 6 даёт зелёное состояние и причина зафиксирована (PR + комментарий в инциденте/issue).

### 7. Закрепить (если повторится)

- Если симптом редкий и его искали через bash — добавь tool в `apps/mcp`, чтобы следующий агент нашёл за один вызов.
- Если симптом был «локально не воспроизводился» — добавь повторяющийся шаг в project MCP, чтобы env-diff/проверка проходили автоматически.
- Если шаг 2 показал, что в Grafana нужного запроса не было — оформи его в `apps/mcp` как обёрточный tool (см. раздел про расширение).

## Когда какой MCP

- «Что-то с продом, я не знаю, что» → **Coolify** (`find_issues`, потом `application_logs` / `diagnose_app`).
- «Знаю, какой сервис, нужны метрики/история» → **Grafana** (`query_loki_logs`, `find_slow_requests`, alerts).
- «Хочу повторить запрос/проверить контракт» → **Project** (`service_request`, `generator_*`, `test_user_*`, `kafka_*`).
- «Надо изменить состояние прода» (рестарт, деплой, env) → **Coolify** (`control`, `deploy`, `env_vars`, `bulk_env_update`).
- «Надо собрать снапшот для отчёта» → `packages/debug-tools` `bundle` + Grafana дашборды через `generate_deeplink`.

## Коротко, что вызывать первым

```text
прод упал           → coolify.find_issues          → coolify.application_logs
5xx у конкретного   → coolify.diagnose_app         → grafana.find_error_pattern_logs
inference плохо     → project.generator_workflows_get → project.generator_execution_submit
auth/сессии         → project.test_user_upsert     → project.service_request
kafka лаг           → project.kafka_consumer_group_describe
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

## Чего не хватает в Coolify/Grafana MCP

Coolify и Grafana MCP — внешние, их код мы не редактируем. Если нужного действия там нет, варианты:

1. **Обёрточный tool в `apps/mcp`.** Завести в `apps/mcp/src/app.ts` отдельный домен (`coolify_*` или `obs_*`), который ходит в публичные API Coolify (`COOLIFY_API_URL` + token) или Grafana и возвращает уже агрегированный ответ под наш сценарий. Это правильный путь, когда нужна композиция (например, «дай логи прод-апа `generator` за окно ±5 минут от последнего деплоя» — это два внешних запроса + склейка).
2. **Composite tool в project MCP.** Если нужно совместить наблюдение и репро (например, «возьми последние 50 ошибок 5xx из Loki, повтори те же запросы через `service_request` локально, верни diff») — это тоже tool в `apps/mcp`, который внутри дёргает `query_loki_logs` через HTTP и `fetchServiceSnapshot` через `@generator/debug-tools/shared`.
3. **Если действие правда отсутствует в самом Coolify/Grafana** — через issue в соответствующий MCP, а пока обходим через их HTTP API в нашем обёрточном tool.

Никогда не подменяй вызов внешнего MCP прямым `curl https://coolify…` без оборачивания в наш tool — это ломает self-debug loop для следующего агента.

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
- Идти за метрикой/логом мимо Grafana MCP в Loki/Prometheus напрямую.
- Перезапускать прод вручную, когда есть `control` / `restart_project_apps`.
- Менять прод-env «через панельку», когда нужны воспроизводимые `env_vars` / `bulk_env_update` (без них следующий агент не узнает, что было сделано).
- Деплоить руками, когда есть `deploy` / `redeploy_project` (тогда нет связи с инцидентом и историей).
- Добавлять tool без схемы `inputSchema` или без `required`.
- Возвращать «голый» текст — все ответы должны идти через `createToolResult`, чтобы был `structuredContent`.
- Делать tool с побочкой (создаёт прод-данные, шлёт реальные платежи и т.п.) без явного защитного флага.
- Дублировать одну логику между `apps/mcp` и `packages/debug-tools` копипастой — общие хелперы держим в `@generator/debug-tools/shared`.
- Останавливать self-debug loop после фикса без шага 6 (подтверждение, что прод действительно зелёный).

## Связанные скилы

- `backend-debug` — рутинная диагностика admin/generator/studio/persons.
- `inference-debug` — путь от workflow до артефакта.

Эти скилы используют ту же базу — если им чего-то не хватает, расширяется именно MCP, а скилы лишь ссылаются на новые тулы.
