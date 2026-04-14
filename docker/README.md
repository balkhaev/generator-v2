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
```

Пример backend-сервиса:

```bash
docker run -d --name admin-api \
  --network generator-net \
  --env-file apps/admin/.env.example \
  -e DATABASE_URL=postgresql://postgres:password@generator-postgres:5432/generator \
  -e REDIS_URL=redis://generator-redis:6379 \
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

- По умолчанию миграции выключены.
- Включаются через `RUN_DB_MIGRATIONS=true`.
- Advisory lock защищает от одновременного запуска нескольких контейнеров с миграциями, но обычно достаточно включить этот флаг только у одного API контейнера на окружение.
- Таймаут и polling можно регулировать через `DATABASE_READY_TIMEOUT_MS` и `DATABASE_READY_INTERVAL_MS`.
