# @generator/runpod

Чистая обёртка над RunPod API: serverless (`api.runpod.ai/v2`) + Pod (`rest.runpod.io/v1`) под общим Workflow-роутером.

## Зачем

- Один контракт `runpod.submit({ workflowId, input })` — не важно serverless или pod, выбор делает workflow definition.
- Все известные RunPod failure-режимы покрыты в SDK: HTTP retry на 429/5xx с уважением `Retry-After`, нормализация error shape'ов из handler'ов, `RUNNING`/`IN_PROGRESS` status sync, защита от capacity-ретраев (они terminal — fallback логика живёт уровнем выше).
- Sensible default `executionTimeout` / `ttl` — RunPod-дефолт в 10 минут / 24 часа прячет реальные проблемы.
- `assessEndpointHealth()` — actionable warnings о неправильной конфигурации endpoint'а ещё до того, как поедет первый запрос.
- Legacy совместимость: `runpod:<endpointId>` и `runpod-pod:<workflowId>` читаются адаптером для существующих executions без миграции БД.

## Слои

```text
HTTP client (bearer + timeout + retry-with-backoff + Retry-After)
   └── api/serverless.ts   /v2/{endpointId}/{run,runsync,status,cancel,health,retry,purge-queue,stream}
   └── api/pods.ts         /v1/pods CRUD + capacity fallback
        └── ServerlessEngine    runSync/run, output normalization, base64 → dataUrl, metrics observer
        └── PodEngine           presigned PUT, S3 sentinel, cleanup, warm-pool, sticky volumes
             └── WorkflowRegistry  (id → ServerlessWorkflow | PodWorkflow)
                  └── createRunpodService { submit, getStatus, cancel }
```

Каждый слой можно тестировать в изоляции — все они ходят к нижнему через простые интерфейсы и легко подменяются `mock`-ами.

## Правильная конфигурация RunPod serverless endpoint

Делать всё через RunPod console / [edit endpoint](https://www.console.runpod.io/serverless). Это базовая настройка, без которой никакая SDK-обвязка не починит «оно ломается и плохо прогревается»:

| Параметр              | Значение                            | Зачем |
| --------------------- | ----------------------------------- | ----- |
| **Active workers**    | **≥ 1**                             | Единственный гарантированный способ убрать cold start. RunPod держит worker warm 24/7, тарифицируется по сниженной "active" цене. Дешевле, чем платить latency-штрафом каждому пользователю. |
| **Max workers**       | ~20% выше ожидаемого peak concurrency | Cost-cap и concurrency-cap. Иначе scale-out режется тихо. |
| **FlashBoot**         | **ON**                              | Восстановление worker'а из спящего state'а за 1–3s вместо 30–60s cold boot. |
| **GPU priority**      | Список 2–3 типов                    | Один тип GPU = риск capacity-throttle. RunPod автоматически идёт по списку. |
| **Auto-scaling type** | **Request count**, scaler = `1`     | Самое отзывчивое масштабирование, особенно для burst-нагрузки. Queue delay прячет проблемы. |
| **Idle timeout**      | 30s+ (не дефолт 5s)                 | Удерживает warm worker'ов между близкими запросами — burst переиспользует один и тот же. |
| **Execution timeout** | См. `defaultPolicy` в workflow      | На уровне endpoint оставь дефолтом, переопределяй per-request через `workflow.defaultPolicy.executionTimeout`. |
| **Data centers**      | Все доступные                       | Сужать только если есть network volume — он привязан к одному DC. |
| **CUDA version**      | Минимально совместимая + всё выше   | Шире пул железа. |

После apply'я этих настроек `assessEndpointHealth(await api.getHealth(...))` должен возвращать `{ healthy: true }`.

### Когда нельзя `Active workers ≥ 1`

Например, dev-окружение или редко используемый endpoint. Включи fallback warm-up runner:

```ts
import {
  createFooocusSdxlWorkflow,
  createServerlessWarmupRunner,
  createRunpodHttpClient,
  createServerlessApi,
} from "@generator/runpod";

const workflow = createFooocusSdxlWorkflow({
  endpointId: process.env.RUNPOD_FOOOCUS_ENDPOINT_ID!,
  enableWarmup: true, // opt-in: lazy ping вместо active workers
});
const http = createRunpodHttpClient({
  apiKey: process.env.RUNPOD_API_KEY!,
  baseUrl: "https://api.runpod.ai/v2",
});
const api = createServerlessApi(http);
const runner = createServerlessWarmupRunner({
  api,
  intervalMs: 4 * 60_000,
  workflow,
});
runner.start();
```

Раз в `intervalMs` runner снимает `/health`. Если warm worker'ов нет — шлёт мини `/runsync` ping с `lowPriority: true` (не триггерит scale-out). Если хотя бы один worker уже idle — skip (экономим на пустых job'ах).

Это **запасной** план — гарантий без `min workers ≥ 1` нет.

## Базовое использование

```ts
import {
  createFooocusSdxlWorkflow,
  createLtx23VideoWorkflow,
  createRunpodService,
} from "@generator/runpod";

const runpod = createRunpodService({
  apiKey: process.env.RUNPOD_API_KEY!,
  s3: resolveS3StorageConfig(),
  workflows: [
    createFooocusSdxlWorkflow({
      endpointId: process.env.RUNPOD_FOOOCUS_ENDPOINT_ID!,
    }),
    createLtx23VideoWorkflow({
      pod: {
        templateId: process.env.RUNPOD_LTX23_POD_TEMPLATE_ID ?? "p4f6rm9tb4",
        // ... pod config
      },
    }),
  ],
});

const sub = await runpod.submit({
  workflowId: "fooocus-sdxl",
  input: { prompt: "studio portrait" },
});
const job = await runpod.getStatus({
  endpointId: sub.endpointId,
  jobId: sub.jobId,
});
```

## RunPod serverless operation surface

`RunpodServerlessApi` покрывает все queue-based операции:

| Метод                                  | RunPod endpoint                         | Когда использовать |
| -------------------------------------- | --------------------------------------- | ------------------ |
| `submit({ endpointId, input, ... })`   | `POST /v2/{id}/run`                     | Default async. Engine'у его достаточно для большинства workflow. |
| `runSync({ endpointId, input, waitMs })` | `POST /v2/{id}/runsync?wait=N`        | Короткие workflow (≤ 30s). Экономит round-trip — клиент получает output в одном ответе. Включается на уровне workflow через `runSync: { enabled: true }`. |
| `getStatus({ endpointId, jobId })`     | `GET /v2/{id}/status/{jobId}`           | Поллинг async job'ов. Возвращает `delayTimeMs` + `executionTimeMs` для observability. |
| `cancel({ endpointId, jobId })`        | `POST /v2/{id}/cancel/{jobId}`          | Отмена in-progress / queued. |
| `retry({ endpointId, jobId })`         | `POST /v2/{id}/retry/{jobId}`           | Перезапуск FAILED / TIMED_OUT без потери job id (только в окне retention — 30 мин для `/run`, 1 мин для `/runsync`). |
| `purgeQueue({ endpointId })`           | `POST /v2/{id}/purge-queue`             | Recovery: чистим pending очередь после misconfiguration / релиза. Жёстко rate-limited (2 req / 10s). |
| `getHealth({ endpointId })`            | `GET /v2/{id}/health`                   | `{ workers: {idle, initializing, ready, running, throttled, unhealthy}, jobs: {...} }`. Передавать в `assessEndpointHealth()`. |

### HTTP retry policy

Дефолт: 4 попытки, exponential backoff (250ms → 8s), уважает `Retry-After` header'у. Ретраит:

- `429 Too Many Requests` (rate limit).
- `5xx` от RunPod / Cloudflare proxy (502, 503, 504, 520-524), **кроме** capacity-сигналов (`no instances`, `out of stock`, …) — те терминальны.
- Network errors: `ECONNRESET`, `fetch failed`, `socket hang up`, `AbortError` от таймаута.

Кастомизация:

```ts
const http = createRunpodHttpClient({
  apiKey,
  baseUrl: "https://api.runpod.ai/v2",
  retry: {
    maxAttempts: 6,
    initialBackoffMs: 500,
    maxBackoffMs: 30_000,
    onRetry: (event) => log.warn("runpod.retry", event),
  },
});
```

### Webhook callback (опционально)

```ts
const workflow = createFooocusSdxlWorkflow({
  endpointId: process.env.RUNPOD_FOOOCUS_ENDPOINT_ID!,
  webhookUrl: "https://your-host/api/runpod/webhook",
});
```

Webhook URL прокидывается в каждый `submit` body. RunPod дёргает его при завершении job'а (с ретраями: 2 раза по 10s в случае не-2xx ответа). Engine при этом всё равно умеет поллить — webhook просто ускоряет реакцию.

## Engine: defaults и observer

`ServerlessEngine` мерджит `workflow.defaultPolicy` (стартовая точка) с `workflow.policy` (override) и передаёт результат в каждый `submit` / `runSync`.

`createFooocusSdxlWorkflow` имеет sensible defaults: `executionTimeout=5min`, `ttl=30min`. Длинные workflow (видео) задают свои.

Observer — sideband channel для метрик:

```ts
const engine = createServerlessEngine({
  api,
  workflow,
  observer: {
    onSubmitted(e) {
      metrics.increment("runpod.submitted", { mode: e.mode });
    },
    onCompleted(e) {
      metrics.histogram("runpod.delay_time_ms", e.delayTimeMs ?? 0);
      metrics.histogram("runpod.execution_time_ms", e.executionTimeMs ?? 0);
    },
  },
});
```

`delayTimeMs` = время в queue + cold start. `executionTimeMs` = собственно обработка handler'ом. Эта пара диагностирует "медленный handler" vs "медленное масштабирование".

## Smoke / health / warmup probes

Реальные пробы, работающие через RunPod API:

```bash
# Submit prompt и поллинг до терминального статуса
RUNPOD_API_KEY=rpa_xxx \
RUNPOD_FOOOCUS_ENDPOINT_ID=xxxxxx \
bun run packages/runpod/scripts/smoke-serverless.ts -- --prompt="cat"

# Snapshot /health + assessment + опциональный /runsync ping
RUNPOD_API_KEY=rpa_xxx \
RUNPOD_FOOOCUS_ENDPOINT_ID=xxxxxx \
bun run packages/runpod/scripts/health-serverless.ts
bun run packages/runpod/scripts/health-serverless.ts --ping

# Долгоживущий fallback warmup-runner (если min workers нельзя)
RUNPOD_API_KEY=rpa_xxx \
RUNPOD_FOOOCUS_ENDPOINT_ID=xxxxxx \
bun run packages/runpod/scripts/warmup-serverless.ts

# Один цикл (для cron)
bun run packages/runpod/scripts/warmup-serverless.ts --once
```

```bash
# Disposable pod — dry-run и live
S3_BUCKET=... S3_ENDPOINT=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
RUNPOD_API_KEY=rpa_xxx \
RUNPOD_LTX23_POD_TEMPLATE_ID=p4f6rm9tb4 \
bun run packages/runpod/scripts/smoke-pod.ts -- --dry-run --prompt="cat"
bun run packages/runpod/scripts/smoke-pod.ts -- --live --prompt="cat"
```

## Контракт workflow

```ts
interface ServerlessWorkflow<TInput, TOutput> {
  id: string;
  mode: "serverless";
  endpointId: string;
  inputSchema: z.ZodType<TInput>;
  buildPayload(input: TInput): Record<string, unknown>;
  parseOutput(raw: unknown): TOutput;
  /** Sensible defaults: executionTimeout (мс), ttl (мс), lowPriority. */
  defaultPolicy?: RunpodPolicy;
  /** Legacy alias для defaultPolicy. */
  policy?: RunpodPolicy;
  /** Опционально: использовать /runsync вместо /run + poll. */
  runSync?: { enabled: boolean; waitMs?: number };
  /** Webhook URL что RunPod дёрнет на завершении. */
  webhookUrl?: string;
  /** Фолбэк warm-up payload (только когда min workers ≥ 1 невозможен). */
  warmup?: ServerlessWarmup<TInput>;
}

interface PodWorkflow<TInput, TOutput> {
  id: string;
  mode: "pod";
  pod: PodSpec; // templateId обязателен — поверх pre-provisioned RunPod template
  inputSchema: z.ZodType<TInput>;
  artifactContentType: string; // "video/mp4" | "image/png" | ...
  buildEnv?(input: TInput): Record<string, string>;
  buildPrompt(input: TInput, ctx: PodSubmitContext): PodSubmitResult;
  prepare?(args: PodPrepareArgs<TInput>): Promise<PodPrepareStatus>;
  parseOutput(ctx: PodSuccessContext): TOutput;
}
```

`PodEngine` создаёт pod из template без перекрытия `dockerStartCmd`, закидывает в env пода `INFERENCE_INPUT_JSON_B64` (Zod-валидный input), `PASSWORD` для ComfyUI-Login и `CIVITAI_TOKEN/HF_TOKEN`. На каждый `getStatus` engine идёт в ComfyUI HTTP API:

1. ждёт `/system_stats` и `userdata/workflows` (template ещё качает чекпоинты);
2. вызывает `workflow.prepare` (idempotent — там скачка LoRA через Lora Manager API + загрузка input image через `/upload/image`);
3. сабмитит `/prompt` с api graph из `workflow.buildPrompt` (идемпотентно через `client_id = requestId`);
4. ждёт `/history`, скачивает артефакт через `/view`, заливает в S3 и удаляет pod.

## Endpoint id format

| Форма                          | Кто пишет           | Кто читает                        |
| ------------------------------ | ------------------- | --------------------------------- |
| `runpod:<workflowId>`          | новый сервис         | сам сервис, адаптер генератора     |
| `runpod:<rawRunPodEndpointId>` | legacy serverless   | сервис (резолв через registry)     |
| `runpod-pod:<workflowId>`      | legacy pod-провайдер | сервис (`LEGACY_POD_ENDPOINT_ID_PREFIX`) |

Адаптер генератора (`apps/generator/src/providers/runpod.ts`) принимает все три формы для обратной совместимости.

## Cost / cleanup гарантии

`PodEngine` удаляет pod на трёх событиях:

1. артефакт появился в S3 (`success`);
2. pod вышел в `EXITED`/`TERMINATED` без артефакта (`failed`);
3. вызван `cancel` (best-effort).

GPU capacity fallback живёт в `api/pods.ts`: первая попытка идёт со всем списком `gpuTypeIds`; если RunPod вернул capacity-ошибку — пробуем по очереди по одному id, аккумулируя ошибки.

`ServerlessEngine` ничего не cleanup'ит — RunPod сам управляет lifecycle worker'ов через scaler. Cost-tuning живёт в endpoint settings (см. таблицу выше).
