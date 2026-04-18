# Endpoint Map

## Production Surface

### `apps/generator`

Canonical execution backend for image and video generation.

Keep:

- `GET /api/health` — liveness only, no DB
- `GET /api/ready` — readiness, pings DB
- `GET /api/workflows`
- `POST /api/executions`
- `GET /api/executions/:executionId`
- `POST /api/executions/sync`

Usage:

- `persons` and `studio` create executions with `POST /api/executions` and read state via `GET /api/executions/:executionId`.
- `POST /api/executions/sync` remains for advanced/manual provider sync paths such as direct execution imports.
- `generator` may push terminal execution updates to internal callback routes in domain services.
- `persons-web` should never call `generator` directly.

### `apps/persons`

Canonical character service.

Keep:

- `GET /api/health` — liveness only, no DB
- `GET /api/ready` — readiness, pings DB
- `GET /api/integrations/server`
- `GET /api/persons`
- `POST /api/persons`
- `POST /api/persons/from-prompt`
- `GET /api/persons/:personId`
- `PATCH /api/persons/:personId`
- `DELETE /api/persons/:personId`
- `POST /api/persons/:personId/generations`
- `POST /api/persons/:personId/generations/import`
- `POST /api/internal/generator-executions`

Usage:

- `persons-web` uses `POST /api/persons` for importing an external reference photo URL.
- `persons-web` uses `POST /api/persons/from-prompt` for prompt-to-avatar generation.
- `persons` uses background completion for prompt jobs and updates the person record when `generator` finishes.
- `POST /api/persons/:personId/generations/import` is now an advanced execution-import endpoint and is not part of the main UI flow.

## UI Surface

### `apps/persons-web`

Main product UI.

Uses:

- `GET /api/persons`
- `GET /api/integrations/server`
- `POST /api/persons`
- `POST /api/persons/from-prompt`
- `GET /api/persons/:personId` indirectly via dashboard polling semantics

Does not need:

- direct access to `generator`
- direct execution import controls for the main happy path

### `apps/admin-web`

Operational UI.

Uses:

- `GET /api/admin/dashboard`
- `GET /api/admin/users`
- `GET /api/admin/settings`
- gateway routes for `persons`, `studio`, `generator` proxied behind the admin auth.

## Legacy Surface

### `apps/studio`

Legacy persisted scenario/run API.

Operational endpoints (always kept):

- `GET /api/health` — liveness only, no DB
- `GET /api/ready` — readiness, pings DB
- `GET /api/studio-snapshot`

Legacy endpoints:

- `GET /api/scenarios`
- `POST /api/scenarios`
- `GET /api/scenarios/:scenarioId`
- `PATCH /api/scenarios/:scenarioId`
- `DELETE /api/scenarios/:scenarioId`
- `GET /api/runs`
- `POST /api/runs`
- `GET /api/runs/:runId`
- `POST /api/runs/:runId/sync`

Status:

- not the canonical path for new integrations
- should not be used by `persons`
- can remain for studio-specific tools until migrated or removed

### `apps/studio` Internal

Keep:

- `POST /api/internal/generator-executions`

## Operational Services

### `apps/db-migrate`

One-shot-style long-running service that owns Drizzle migration runs.

Endpoints:

- `GET /api/health` — liveness, always 200
- `GET /api/ready` — 200 when last migration succeeded, 503 otherwise
- `GET /api/status` — full status of last migration attempt (`state`, `startedAt`, `completedAt`, `durationMs`, `error`)
- `POST /api/migrate` — re-run migrations (Bearer-auth via `MIGRATE_TRIGGER_TOKEN` if set)

Deploy `db-migrate` first; deploy other services with `RUN_DB_MIGRATIONS=false` after it goes healthy. See `docker/README.md` for the full deploy workflow.
