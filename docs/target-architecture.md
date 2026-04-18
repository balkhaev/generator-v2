# Target Architecture

## Goal

Разделить систему на понятные bounded contexts:

- `generator-api` — stateless execution engine
- `studio-api` — studio domain и его данные
- `persons-api` — persons domain и его данные
- `admin-api` — auth, control plane, topology, admin workflows
- `admin-web`, `studio-web`, `persons-web` — UI delivery layers

Главное правило:
`generator-api` не владеет бизнес-сущностями и не хранит долговременное состояние продукта.

## Service Map

### `apps/generator-api`

Ответственность:
- принять команду на генерацию
- валидировать execution payload
- поставить execution в свою внутреннюю очередь
- вызвать inference provider (Replicate / Fal AI)
- хранить execution state до terminal статуса
- вернуть технический результат выполнения
- асинхронно синхронизировать provider status

Не хранит:
- `persons`
- `scenarios`
- `studio runs`
- `auth sessions`
- UI presets
- review state

Допустимые данные:
- технические execution records
- provider ids
- artifacts / error summary
- внутренняя job queue для provider orchestration

Контракт:
- `POST /executions`
- `GET /executions/:executionId`

Рекомендуемый ответ:
- `executionId`
- `providerJobId`
- `providerEndpointId`
- `status`
- `acceptedAt`
- `artifacts` только если уже готовы

### `apps/studio-api`

Ответственность:
- studio scenarios
- studio runs
- run history
- presets
- review metadata
- связка между studio domain и generator execution

Хранит:
- `studio_scenario`
- `studio_run`
- `studio_run_artifact`
- `studio_preset`
- studio-specific metadata

Интеграция:
- вызывает `generator-api`
- хранит у себя `generatorExecutionId`
- читает status из `generator-api`
- не оркестрирует provider queue локально

### `apps/persons-api`

Ответственность:
- persons
- datasets / loras / media attachments
- person-specific generations
- person workflows

Хранит:
- `person`
- `person_generation`
- person asset references
- свои связи с execution

Интеграция:
- вызывает `generator-api`
- хранит у себя `generatorExecutionId` и business outcome
- читает status из `generator-api`
- не оркестрирует provider queue локально

### `apps/admin-api`

Ответственность:
- Better Auth
- admin-only orchestration
- topology management
- internal gateway/use-case composition

Не должен становиться общим местом для доменных write-моделей.
Он control plane, не product domain.

## Data Ownership

### Ownership Rule

Одна сущность = один владелец.

- `studio-api` владеет studio runs/scenarios
- `persons-api` владеет persons/person generations
- `admin-api` владеет admin assets/topology/auth
- `generator-api` не владеет product entities

Запрещено:
- shared DB ownership между сервисами
- чтение чужих таблиц напрямую
- “временное” использование `generator-api` как product storage

## Call Flows

### Studio Flow

1. `studio-web` -> `studio-api`
2. `studio-api` создает `studio_run` со статусом `queued`
3. `studio-api` -> `generator-api` `POST /executions`
4. `generator-api` создает execution row и ставит job в BullMQ
5. `generator-api` worker ходит в provider и обновляет execution state
6. `generator-api` пушит terminal update в `studio-api` callback
7. `studio-api` сохраняет `generatorExecutionId` и обновляет свой `studio_run`

### Persons Flow

1. `persons-web` -> `persons-api`
2. `persons-api` создает свою generation/job запись
3. `persons-api` -> `generator-api`
4. `persons-api` сохраняет `generatorExecutionId`
5. `generator-api` пушит terminal update в `persons-api` callback
6. `persons-api` хранит outcome внутри собственного домена

### Admin Flow

1. `admin-web` -> `admin-api`
2. `admin-api` управляет topology/assets/auth
3. если нужно посмотреть доменные данные, `admin-api` читает их через публичные API доменных сервисов, не через shared tables

## Contracts

Разделять контракты по доменам:

- `packages/contracts/generator`
- `packages/contracts/studio`
- `packages/contracts/persons`
- `packages/contracts/admin`

В контрактах держать только serialized API shapes:
- ISO strings для дат
- DTO request/response
- enums/statuses

Не держать там:
- repository types
- ORM types
- service internals
- `Date`

## Package Rules

### Shared Packages

- `packages/http`
  transport helpers only
- `packages/auth-client`
  web auth client only
- `packages/ui`
  reusable UI primitives only
- `packages/contracts/*`
  public API DTO only
- `packages/generator-client-server`
  server-side typed client to generator
- `packages/queue`
  shared BullMQ / Redis primitives only

## Runtime Rules

- callbacks are the primary domain update path from `generator-api` to `persons-api` and `studio-api`
- domain repair workers are fallback tools, not the default steady-state synchronization path
- `GET` handlers must stay read-only
- `packages/generator-client-web`
  only if browser access to generator/admin endpoints becomes common

### App Rules

Apps may import packages.
Apps must not import another app.

## Proposed Directory Layout

```text
apps/
  admin-api/
  admin-web/
  generator-api/
  persons-api/
  persons-web/
  studio-api/
  studio-web/

packages/
  auth/
  auth-client/
  config/
  contracts/
    admin/
    generator/
    persons/
    studio/
  db/
  env/
  http/
  ui/
  generator-client-server/
```

## Database Layout

### `admin-api` DB

- auth tables
- topology/config tables

### `studio-api` DB

- scenarios
- studio runs
- review / preset / workflow state

### `persons-api` DB

- persons
- person generations
- person media references

### `generator-api`

Prefer no product DB.
Если без БД не получается, только технические execution records, не доменные сущности.

## Migration Path

### Phase 1

- переименовать сервисы концептуально:
  - `generator` -> `generator-api`
  - `persons` -> `persons-api`
  - `studio` -> `studio-api`
  - `admin` -> `admin-api`

### Phase 2

- вынести generator-facing typed client в package
- все вызовы generator привести к одному client layer

### Phase 3

- убрать из `generator-api` таблицы `scenario`, `run` и другую product state логику
- перенести studio state в `studio-api`

### Phase 4

- перенести person generation ownership полностью в `persons-api`

### Phase 5

- оставить в `generator-api` только execution engine и provider integration

## Decision Rules

При добавлении новой сущности задавать 3 вопроса:

1. Это product/domain state или execution state?
2. Кто владеет lifecycle этой сущности?
3. Нужна ли она больше чем одному сервису, или только одному bounded context?

Если это domain state, она не должна жить в `generator-api`.

## Short Version

- `generator-api` = stateless engine
- `studio-api` = scenarios + runs
- `persons-api` = persons + person generations
- `admin-api` = auth + control plane
- web apps только вызывают свои API
- сервисы общаются через contracts, не через shared tables
