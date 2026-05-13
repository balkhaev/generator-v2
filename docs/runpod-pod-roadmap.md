# RunPod Pod Inference — Optimisation Roadmap

Цель: минимизировать latency и стоимость on-demand inference на RunPod при
честном "без висящих pod'ов" режиме. Этот документ — план в порядке убывания
ROI после Phase 0 (network volumes + warm pool, уже сделано).

Связанные файлы:

- `packages/runpod/src/engine/pod-engine.ts` — submit / getStatus / cleanup.
- `packages/runpod/src/engine/warm-pod-pool.ts` — интерфейсы `WarmPodPool`,
  `PodInputStore`, `ActivePodRegistry` и in-memory impls.
- `apps/generator/src/providers/runpod-warm-pool.ts` — Redis impls + reaper.
- `apps/generator/src/worker.ts` / `app.ts` — wiring.

---

## Phase 0 — сделано

1. **Multi-volume pool** (10 network volumes, разные DC/GPU). Submit перебирает
   все volumes пока не получит capacity.
2. **Warm pod pool** (Redis ZSET, score = expiresAt). Успешный exec возвращает
   pod в пул на `keepAliveMs`; следующий submit для того же workflow реюзает.
3. **Pod input store** (Redis SET с TTL). Side-channel для input'а реюзаемого
   пода (env у живого pod'а уже фиксирован).
4. **Pod reaper** (раз в 60s). Убивает orphan pods нашего префикса, которых нет
   ни в warm pool, ни активных, и старше `safetyAgeMs`.
5. **Active pod registry** (Redis ZSET). Pod-engine регистрирует pod при создании
   и снимает при release/cleanup. Reaper защищает active + warm; safetyAgeMs
   снижается до роли backstop'а на случай worker crash'а.

После Phase 0 уже исключены:

- premature reap активного inference'а (был критичный bug — registry устранил);
- пересоздание pod'а в burst (warm reuse);
- холодный download моделей (network volume).

---

## Phase 1 — Smart capacity retry (приоритет: высокий)

**Проблема.** Сейчас если все volumes возвращают "no capacity", submit бросает
исключение → BullMQ исчерпывает retries (5×) → execution falls в `failed`.
Пользователь видит ошибку, хотя через 2–5 минут capacity почти всегда есть.

**Решение.** В `apps/generator/src/queue/executions.ts` или прямо в
`processExecutionSubmitJob` обернуть `isNoCapacityError(error)`:

- использовать BullMQ `Worker.move(...)` с delay (60–120s), не считать как
  retry, до общего лимита 20–30 минут wall-clock;
- метрика `runpod.submit.capacity_retry` (counter);
- по истечении окна — markFailed с понятным message.

Если delay-strategy внутри BullMQ окажется неудобной (через `attempts` + custom
backoff лучше всего), альтернатива — separate "pending-submit" zset в Redis,
который worker drain'ит при каждом tick'е. BullMQ путь проще.

**Тест.** Юнит: handler выкидывает `no capacity` → submit повторно ставится с
delay. Интеграция: подменить `runpodService.submit` через mock возвращающий
no-capacity первые N раз, потом успех — execution должен дойти до `running`.

---

## Phase 2 — Sticky volume per request (приоритет: средний)

**Проблема.** При retry'е (любого рода — capacity-bounce, transient 5xx, и
т.п.) submit идёт заново через `createPodAcrossVolumes`, который выбирает
volume в порядке списка. Если первый retry успел shedule на volume A (там
скачались модели), а повтор лёг на volume B (модели не warm) — теряем ~10 мин.

**Решение.** Хранить в Redis `runpod:sticky-volume:<executionId>` →
`<networkVolumeId>` с TTL ~30 мин. При retry submit'е, если ключ есть,
переставить выбранный volume в начало `networkVolumes` массива (или передать
вторым параметром в `createPodAcrossVolumes`). Сохраняется на первой успешной
аллокации.

**Опасность.** Если sticky volume сам потерял capacity, всё равно идём по
fallback'у — старый поведение сохраняется как safety.

---

## Phase 3 — Concurrency cap (приоритет: средний)

**Проблема.** Сейчас при burst'е (например, 50 одновременных requests) submit
будет пытаться создать 50 pod'ов. RunPod аккаунт упрётся в лимиты, мы — в
бюджет. Active registry уже даёт точное число in-flight pods, но мы его не
используем для backpressure.

**Решение.**

- Конфиг: `RUNPOD_LTX23_POD_MAX_CONCURRENCY=10`.
- В `submit`: перед `tryReuseWarmPod` смотреть
  `activeRegistry.list().length`. Если ≥ cap — задерживать submit'ы (BullMQ
  rate limiter уже умеет это, см. `Queue.add({ delay })` + `concurrency`
  setting на worker'е). BullMQ-уровневая ограничилка проще и атомарнее.
- Альтернатива: Redis Lua-токен `runpod:active-token:<workflowId>` (LPOP с
  таймаутом) — точнее, но усложняет код.

**Эффект.** Защищает от accidental DOS на свой кошелёк и от capacity-throttle
на стороне RunPod (когда они начинают rate-limit нашу учётку).

---

## Phase 4 — Periodic warm pool health check (приоритет: средний)

**Проблема.** Сейчас warm pod может "сгнить" внутри `keepAliveMs`: ComfyUI
крашнулся, RunPod restart'нул контейнер с очищенным VRAM, network volume
detach'нулся. Submit это узнает только при reuse: `verifyWarmPodAlive` ping'ом
ComfyUI. Между ping'ами pod зря тратит деньги, и burst в этот момент
переходит в "claim → forget → new pod" — ещё одна холодная итерация.

**Решение.** Раз в N секунд (например, 30s) в worker'е итерироваться по
`warmPool.list()` и звонить `comfyui.systemStats` на каждом. На failure —
`warmPool.forget` + `api.delete`. Реюзает уже существующий механизм
`verifyWarmPodAlive` из pod-engine — выносим в отдельный helper.

**Когда не нужно.** Если `keepAliveMs` ≤ 5–10 мин, polling overhead не
оправдан — простой next-submit и так выкинет мёртвую запись.

---

## Phase 5 — Refresh warm-pool TTL on reuse (приоритет: низкий)

**Проблема.** Warm-pool entry имеет фиксированный `expiresAt = released + ttl`.
Если pod 9 минут стоял в пуле, был реюзан и снова отпущен — TTL начнётся с
нуля. Это уже OK (`release` обновляет score). Но если pod в момент claim
почти прострочен и `getStatus` идёт 10+ мин, при следующем release он живёт
тот же `ttl`. Не баг, скорее sanity.

**Решение.** Метрика `runpod.warm_pool.reuse_count` (per podId). Если pod
реюзается > 20 раз — добавить explicit `api.delete` чтобы не утечь VRAM
fragmentation'ом ComfyUI. ComfyUI вообще-то не утекает, но это безопаснее.

---

## Phase 6 — Cost / latency telemetry (приоритет: средний)

**Проблема.** Сейчас не видим honest "cold vs warm latency" и "cost per
generation". Метрики разбросаны по логам.

**Решение.** Hooks в pod-engine на ключевых переходах:

- `submit.via_warm_reuse` / `submit.created_pod` (counter);
- `pod.boot_ms` (histogram, от `api.create` до первого 200 от ComfyUI);
- `pod.exec_ms` (histogram, от prompt submit до artifact в S3);
- `pod.total_ms` = boot + exec (histogram);
- `cost.estimated_usd` = `total_ms * gpu_hourly_rate / 3.6e6` (по сегодняшней
  цене из RunPod GraphQL — кэшировать раз в час).

В Grafana dashboard "RunPod inference health": median/p95 warm vs cold,
успешность warm reuse, % no-capacity, активные pods over time.

---

## Phase 7 — Pre-warm pool (приоритет: низкий, спорный)

**Идея.** Держать N=1 "теплый" pod 24/7. Принципиально противоречит
"on-demand", и пользователь явно сказал нет. Не делать.

**Когда возвращаться.** Если daily inference count > 100 и cold-start latency
по-прежнему > 5 мин на p95 — стоимость одного pod'а в простое (~$0.40/час) <
стоимости потерянных пользователей. Тогда: N pre-warm-pod controller, который
держит target количество, читая warm-pool size + queue depth.

---

## Phase 8 — GPU price-aware volume selection (приоритет: низкий)

**Идея.** Сейчас `createPodAcrossVolumes` перебирает volumes в порядке списка
из env. Дешёвые volumes/GPUs (A6000) идут после дорогих (H100/B200) — но цена
не учитывается. Если на A6000 есть capacity, мы могли бы сэкономить ~3×.

**Решение.** Подтягивать current GPU spot prices через RunPod GraphQL раз в
15 мин, сортировать volumes по `price_per_minute` ASC, и сабмитить так.
Сложность: для real-time inference latency matters, и A6000 на LTX-2.3 в
~2× медленнее H100 — экономия не очевидна. Сначала Phase 6 метрики, потом
решать.

---

## Open questions

1. **TTL active registry vs timeoutMs.** Сейчас TTL =
   `timeoutMs + 5 min`. Если workflow перестанет иметь `timeoutMs`, мы
   fallback'аемся на 2 часа. Подумать: добавить hard cap (~3 часа), чтобы
   баги/циклы в submit не утекли pod на сутки.
2. **Reaper interval.** 60s — компромисс. Если active registry надёжен, можно
   опустить до 5 мин (меньше нагрузки на RunPod API). Подтвердить после
   деплоя метриками.
3. **Warm-pool cap.** Сейчас пул не ограничен. При высоком burst'е и `keepAlive
   10 min` можем легко набрать > 20 pods. Добавить max pool size + LRU eviction.

---

## Definition of Done (per phase)

- Tests passing (`bun test packages/runpod` + scoped generator tests).
- `bun --cwd apps/generator run check-types` zero errors.
- `bun x ultracite check <changed files>` clean.
- Метрика добавлена в Grafana dashboard если применимо.
- Coolify env-vars обновлены и сервисы рестартанули.
- Smoke test: один cold + один warm submit, latency в логах ожидаемый.
