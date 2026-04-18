# Docker runbook

В репозитории есть три общих production-образа:

- `docker/api.Dockerfile` для Bun/Hono API сервисов
- `docker/worker.Dockerfile` для фоновых worker/reconcile процессов
- `docker/web.Dockerfile` для Next.js фронтов

Для именованных сервисов добавлен `docker-bake.hcl`, поэтому можно собирать как отдельную цель, так и весь набор без `docker-compose`.

## Что уже учтено

- `turbo prune --docker` уменьшает build-context под конкретный сервис
- install-слои отделены от исходников, поэтому повторная сборка не переустанавливает зависимости без необходимости
- фронты собираются в `standalone`, рантайм не тащит весь workspace
- backend/worker контейнеры умеют ждать Postgres и прогонять Drizzle migrations под `pg_advisory_lock`
- для API и web выставлены встроенные `HEALTHCHECK`
- Kafka используется как шина событий между доменными сервисами: generator публикует статусы executions, admin-worker публикует события LoRA training, а persons/studio workers подписываются на свои consumer groups

## Сборка

Собрать один сервис:

```bash
docker buildx bake admin-api
docker buildx bake generator-worker
docker buildx bake studio-web
```

Собрать все API / workers / web:

```bash
docker buildx bake apis
docker buildx bake workers
docker buildx bake webs
```

Собрать вообще всё:

```bash
docker buildx bake all
```

Если `buildx bake` не нужен, можно собрать напрямую:

```bash
docker build \
  -f docker/api.Dockerfile \
  --build-arg APP_NAME=admin \
  --build-arg APP_PORT=3000 \
  --build-arg SERVICE_ENTRYPOINT=apps/admin/dist/index.mjs \
  -t generator/admin-api:local \
  .
```

## Запуск без compose

Создай сеть один раз:

```bash
docker network create generator-net
```

Подними инфраструктуру по отдельности:

```bash
docker run -d --name generator-postgres \
  --network generator-net \
  -e POSTGRES_DB=generator \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 \
  postgres:16-alpine

docker run -d --name generator-redis \
  --network generator-net \
  -p 6379:6379 \
  redis:7-alpine

docker run -d --name generator-kafka \
  --network generator-net \
  -e KAFKA_NODE_ID=1 \
  -e KAFKA_PROCESS_ROLES=broker,controller \
  -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@generator-kafka:9093 \
  -e KAFKA_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093 \
  -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://generator-kafka:9092 \
  -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT \
  -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
  -e KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  -e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 \
  -e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 \
  apache/kafka:3.9.1
```

Пример backend-сервиса:

```bash
docker run -d --name admin-api \
  --network generator-net \
  --env-file apps/admin/.env.example \
  -e DATABASE_URL=postgresql://postgres:password@generator-postgres:5432/generator \
  -e REDIS_URL=redis://generator-redis:6379 \
  -e KAFKA_BROKERS=generator-kafka:9092 \
  -e GENERATOR_API_URL=http://generator-api:3005 \
  -e STUDIO_API_URL=http://studio-api:3006 \
  -e PERSONS_API_URL=http://persons-api:3003 \
  -e RUN_DB_MIGRATIONS=true \
  -p 3000:3000 \
  generator/admin-api:local
```

Пример worker:

```bash
docker run -d --name generator-worker \
  --network generator-net \
  --env-file apps/generator/.env.example \
  -e DATABASE_URL=postgresql://postgres:password@generator-postgres:5432/generator \
  -e REDIS_URL=redis://generator-redis:6379 \
  -e KAFKA_BROKERS=generator-kafka:9092 \
  generator/generator-worker:local
```

Пример web:

```bash
docker run -d --name admin-web \
  --network generator-net \
  --env-file apps/admin-web/.env.example \
  -e NEXT_PUBLIC_SERVER_URL=http://admin-api:3000 \
  -e NEXT_PUBLIC_STUDIO_URL=http://studio-web:3002 \
  -e NEXT_PUBLIC_PERSONS_URL=http://persons-web:3004 \
  -p 3001:3001 \
  generator/admin-web:local
```

## Миграции

Каноничный способ — отдельный сервис `db-migrate` (`apps/db-migrate`):

- Это long-running Hono-сервис на порту `3010`.
- На старте всегда применяет все pending Drizzle-миграции под защитой Postgres advisory lock (`pg_advisory_lock(48612451)`).
- После завершения остаётся живым: `GET /api/health` всегда отдаёт `200 {ok: true}` (это нужно Coolify/Docker, чтобы не килять контейнер).
- `GET /api/status` отдаёт детали последней попытки: `state` (`pending|running|succeeded|failed`), `startedAt`, `completedAt`, `durationMs`, `error`.
- `GET /api/ready` возвращает 200 при `succeeded`, 503 при `failed/running/pending`.
- `POST /api/migrate` повторно прогоняет миграции без редеплоя контейнера. Защищается опциональным `MIGRATE_TRIGGER_TOKEN` (Bearer).
- `GET /api/db-info` (Bearer) — диагностический snapshot: к какому хосту подключён сервис, что лежит в `drizzle.__drizzle_migrations`, какие колонки есть у `studio_run`. Нужен для разбора инцидентов «миграции вроде применились, а колонок нет».
- `POST /api/repair-journal` (Bearer, body `{"drop_last_n": 1}`) — точечная починка журнала: удаляет N последних записей из `drizzle.__drizzle_migrations` и перезапускает `runMigrations()`. Нужен в редких ситуациях, когда `journal.json` содержит миграции с `when` меньше последнего применённого `created_at` — drizzle migrator silently их пропускает. Действие деструктивное: удалённые миграции должны быть либо идемпотентными, либо ещё ни разу не применёнными в этой БД.

Минимальный набор переменных окружения:

```bash
DATABASE_URL=postgres://user:pass@host:5432/db
PORT=3010
SERVICE_ENTRYPOINT=apps/db-migrate/dist/index.mjs
APP_NAME=db-migrate
# Опционально:
DATABASE_READY_TIMEOUT_MS=120000
DATABASE_READY_INTERVAL_MS=2000
DATABASE_MIGRATION_LOCK_ID=48612451
MIGRATE_TRIGGER_TOKEN=...   # для POST /api/migrate
```

Workflow деплоя со схема-меняющими PR:

1. Деплой `db-migrate` — он применяет миграции и переходит в healthy.
2. Деплой остальных API/worker сервисов с тем же commit SHA.
3. Если миграции упали — `db-migrate` всё равно остаётся live; смотри `GET /api/status` и логи.

### Подводный камень: timestamps в `meta/_journal.json`

Drizzle migrator применяет миграцию только если её `when` (folder timestamp в journal) больше последнего `created_at` в `drizzle.__drizzle_migrations`. Если в журнале появляется миграция с **намеренно завышенным** `when` (например, ручной round-timestamp типа `1776600000000`), все последующие миграции с меньшим `when` будут **молча** пропущены — `runMigrations()` отчитается об успехе за десятки миллисекунд, но новых колонок не будет.

Именно так на проде в апреле 2026 пропустились `0007_amused_franklin_richards` и `0008_drop_asset_release_tables`: у них `when` оказался меньше, чем у вручную помеченного `0006_unify_lora_workflow_keys` (`1776600000000`).

Профилактика:
- НЕ редактируйте `when` в `meta/_journal.json` руками. Дайте `drizzle-kit generate` поставить `Date.now()`.
- Если уже случилось: использовать `POST /api/repair-journal` чтобы удалить «пробку» из журнала и переприменить пропущенные миграции (см. описание выше). Для диагностики — `GET /api/db-info`.

### Fallback: миграции на entrypoint API

Старый механизм всё ещё поддерживается:

- `RUN_DB_MIGRATIONS=true` на API/worker контейнере → entrypoint вызывает `bun packages/db/src/run-migrations.ts` перед стартом сервиса.
- Advisory lock защищает от гонки между несколькими контейнерами.
- Таймаут и polling регулируются через `DATABASE_READY_TIMEOUT_MS` и `DATABASE_READY_INTERVAL_MS`.

Использовать имеет смысл только если по каким-то причинам нельзя завести отдельный `db-migrate`. При наличии `db-migrate` отключите `RUN_DB_MIGRATIONS` у всех остальных сервисов, чтобы избежать лишней блокировки lock'а на каждом старте.

## Health vs readiness

Все Bun/Hono API сервисы экспонируют два эндпоинта:

- `GET /api/health` — **liveness**. Возвращает `200 {ok: true, service}` всегда, пока процесс жив. БД и внешние зависимости НЕ трогает. Это эндпоинт для Docker `HEALTHCHECK`, Coolify health check, Kubernetes liveness probe.
- `GET /api/ready` — **readiness**. Делает `select 1` в БД, отдаёт 200 при успехе и 503 при ошибке. Используется только для диагностики и ручных проверок. Не подключайте к деплой-гейтам — это сделает деплой хрупким при schema-меняющих PR.

Ранее `/api/health` в studio/persons/generator делал реальные запросы к БД (`listRuns`, `listPersons` и т.п.). Это приводило к 500-кам во время прокатки миграций и к тому, что Docker килял старые контейнеры с health-check failure. Теперь этого нет.

## Event bus

Локально `docker compose up -d` поднимает Kafka на `localhost:9092`.
Внутри Docker-сети сервисы должны использовать `KAFKA_BROKERS=generator-kafka:9092`
или имя сервиса compose, например `kafka:9092`.
