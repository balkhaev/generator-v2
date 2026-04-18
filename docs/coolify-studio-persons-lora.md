# Coolify: Cast LoRA в Studio (persons + studio-api)

Подстановка LoRA выбранной персоны при запуске рана делается на **studio-api**: сервер дергает persons `GET /api/persons/:id` и кладёт `loraUrl` в параметры execution. Нужны корректные **`PERSONS_API_URL`** и проброс **Cookie** сессии до persons.

## Два разных URL (не путать)

| Переменная | Где | Назначение |
|------------|-----|------------|
| `NEXT_PUBLIC_PERSONS_API_URL` | **studio-web** (build/runtime фронта) | Запросы **из браузера** к persons (список персон, сетка Cast). Должен быть **публичный** HTTPS с тем же доменным уровнем, что и сессия пользователя (см. Cookie). |
| `PERSONS_API_URL` | **studio-api** (и **studio-worker**, если поднимаете отдельно) | **Серверный** HTTP из контейнера studio к persons. Может быть **внутренним** адресом Docker, если persons доступен в той же сети — так не гоняете трафик через внешний прокси. |

Локальный аналог в `docker/README.md`: `PERSONS_API_URL=http://persons-api:3003` для backend и отдельный публичный URL для фронта при необходимости.

## Coolify вместо «ручных» URL

1. **Один Docker Compose / Service Stack в Coolify**  
   Обращайтесь к persons по **имени сервиса** из compose и внутреннему порту, например `http://persons-api:3003` (имя должно совпадать с ключом сервиса в YAML). Это предпочтительный вариант для `PERSONS_API_URL` на studio-api: без hairpin через публичный wildcard.

2. **Magic-переменные Coolify** (`SERVICE_URL_*`, `SERVICE_FQDN_*`)  
   Удобны, когда URL должен собираться из стека и оставаться стабильным между деплоями. Описание синтаксиса: [Magic Environment Variables in Docker Compose](https://coolify.io/docs/knowledge-base/docker/compose#coolify-s-magic-environment-variables).  
   Имейте в виду: сгенерированные `SERVICE_URL_*` часто указывают на **внешний** wildcard-домен Coolify, а не на «чистый» Docker DNS. Для server-to-server внутри одного сервера обычно выгоднее имя сервиса из compose; magic — когда без публичного DNS не обойтись или когда стек уже завязан на них.

3. **Разные приложения Coolify (разные стеки)**  
   Либо включите общую Docker-сеть (**Connect to Predefined Network** в доке Coolify по compose) и используйте известный hostname контейнера persons, либо задайте `PERSONS_API_URL` на **публичный** HTTPS persons — запрос пойдёт наружу, но Cookie с заголовка пользователя всё равно передаётся.

4. **Один раз на окружение**  
   В Coolify можно вынести базовый URL в [Shared Variables](https://coolify.io/docs/knowledge-base/environment-variables#shared-variables) уровня `environment` и подставить в несколько сервисов через `{{environment.PERSONS_API_URL}}`, чтобы не дублировать значение между studio-api и studio-worker.

## Cookie и Better Auth

- studio-api при создании рана пересылает в persons заголовок **`Cookie`** из входящего запроса к API (см. `apps/studio/src/routes/runs.ts`).
- Секрет и конфиг сессии должны совпадать с persons (**`BETTER_AUTH_SECRET`**, тот же пул пользователей), как и для остальных сервисов монорепы.
- Если studio-web и persons-api на **разных поддоменах**, cookie должна быть выдана с **`Domain`**, общим для обоих (например родительский домен продукта), иначе браузер не приложит сессию к запросам на persons, а studio-api не сможет прокинуть валидную сессию при резолве LoRA.

## Проверка после деплоя

- В Coolify MCP: `env_vars` для приложения **studio-api** — есть `PERSONS_API_URL`, значение резолвится изнутри контейнера (имя сервиса или рабочий HTTPS).
- Запуск рана с выбранной персоной с LoRA не должен отдавать `PERSONS_API_URL is not configured` или 401/403 от persons при том же пользователе, что залогинен в studio-web.

Подробнее про отладку через Coolify MCP и project MCP: `AGENTS.md`, `.agents/skills/mcp-debug/SKILL.md`.
