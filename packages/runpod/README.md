# @generator/runpod

Чистая обёртка над RunPod API: serverless (`api.runpod.ai/v2`) + Pod (`rest.runpod.io/v1`) под общим Workflow-роутером.

## Зачем

- Один контракт `runpod.submit({ workflowId, input })` — не важно serverless или pod, выбор делает workflow definition.
- On-demand траты: serverless по природе не стоит idle, pod создаётся → пишет артефакт в S3 → удаляется тем же engine.
- Capacity fallback по `gpuTypeIds` встроен в `api/pods.ts`.
- Legacy совместимость: `runpod:<endpointId>` и `runpod-pod:<workflowId>` читаются адаптером для существующих executions без миграции БД.

## Слои

```text
HTTP client (bearer + timeout + error parsing)
   └── api/serverless.ts   /v2/{endpointId}/run|status|cancel
   └── api/pods.ts         /v1/pods CRUD + capacity fallback
        └── ServerlessEngine    output normalization, base64 → dataUrl
        └── PodEngine           presigned PUT, S3 sentinel, cleanup
             └── WorkflowRegistry  (id → ServerlessWorkflow | PodWorkflow)
                  └── createRunpodService { submit, getStatus, cancel }
```

Каждый слой можно тестировать в изоляции — все они ходят к нижнему через простые интерфейсы и легко подменяются `mock`-ами.

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
        bootstrapUrl: process.env.RUNPOD_LTX23_POD_BOOTSTRAP_URL!,
        gpuTypeIds: ["NVIDIA RTX A6000", "NVIDIA A40"],
        imageName: "ls250824/run-comfyui-ltx:28042026",
      },
    }),
  ],
});

const sub = await runpod.submit({
  workflowId: "fooocus-sdxl",
  input: { prompt: "studio portrait" },
});
// sub.endpointId === "runpod:fooocus-sdxl"

const job = await runpod.getStatus({
  endpointId: sub.endpointId,
  jobId: sub.jobId,
});
```

## Smoke probes

Реальные пробы работающие напрямую через RunPod API:

```bash
RUNPOD_API_KEY=rpa_xxx \
RUNPOD_FOOOCUS_ENDPOINT_ID=xxxxxx \
bun run packages/runpod/scripts/smoke-serverless.ts -- --prompt="cat"
```

```bash
# Dry-run (без вызовов RunPod, только печать env и dockerStartCmd)
S3_BUCKET=... S3_ENDPOINT=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
RUNPOD_API_KEY=rpa_xxx \
RUNPOD_LTX23_POD_BOOTSTRAP_URL=https://.../pod-bootstrap.sh \
bun run packages/runpod/scripts/smoke-pod.ts -- --dry-run --prompt="cat"

# Live (реально создаёт pod, ждёт MP4 в S3, удаляет pod)
bun run packages/runpod/scripts/smoke-pod.ts -- --live --prompt="cat"
```

В обоих случаях скрипт печатает таймлайн событий (`smoke.start`, `smoke.submitted`, `smoke.poll`, `smoke.success | smoke.failed | smoke.timeout`).

## Контракт workflow

Любой workflow реализует один из двух интерфейсов:

```ts
interface ServerlessWorkflow<TInput, TOutput> {
  id: string;
  mode: "serverless";
  endpointId: string;
  inputSchema: z.ZodType<TInput>;
  buildPayload(input: TInput): Record<string, unknown>;
  parseOutput(raw: unknown): TOutput;
  policy?: RunpodPolicy;
}

interface PodWorkflow<TInput, TOutput> {
  id: string;
  mode: "pod";
  pod: PodSpec;
  inputSchema: z.ZodType<TInput>;
  artifactContentType: string; // "video/mp4" | "image/png" | ...
  buildEnv(input: TInput, ctx: PodRuntimeContext): Record<string, string>;
  parseOutput(ctx: PodSuccessContext): TOutput;
}
```

`PodEngine` сам выдаёт workflow'у:

- `requestId` (uuid),
- presigned PUT URL для артефакта (`OUTPUT_UPLOAD_URL`) и логов (`LOG_UPLOAD_URL`),
- публичные URL для чтения после загрузки.

Workflow возвращает `Record<string, string>` env, который попадает в pod.

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
