# PRD — ComfyUI Runpod Operator MVP

## Metadata
- Source spec: `.omx/specs/deep-interview-plan-md.md`
- Context snapshot: `.omx/context/plan-md-20260404T082700Z.md`
- Plan mode: `ralplan --consensus`
- Deliberation mode: `short`
- Status: `approved`

## RALPLAN-DR Summary

### Principles
1. Ship the smallest end-to-end operator workflow before building platform breadth.
2. Keep the scenario as the core product primitive: workflow + prompt + reusable params + repeated input-image runs.
3. Separate control-plane metadata from runtime/provider adapters even if MVP lives mostly in `apps/server`.
4. Defer costly infra promises (multi-region replication, LoRA training, strong consistency guarantees) until the operator workflow is proven.
5. Verification must prove the operator product flow, not just isolated API endpoints.

### Decision Drivers
1. Fastest path to a usable internal operator flow inside the existing monorepo.
2. Lowest operational complexity while preserving a clean seam for later Runpod/storage expansion.
3. Testable MVP acceptance around one concrete workflow (`ltx-2.3 i2v`).

### Viable Options

#### Option A — Server-centric MVP inside existing apps/packages (**Chosen**)
- Shape: implement the control plane inside `apps/server`, persist state in `packages/db`, add env contracts in `packages/env`, and build the admin surface in `apps/web`.
- Pros:
  - Smallest diff on the current repo.
  - Reuses Hono/Bun, Next.js, Drizzle, env patterns already present.
  - Fastest route to end-to-end proof.
- Cons:
  - `apps/server` can become crowded if provider logic is not well-bounded.
  - Later extraction to dedicated packages/services may be needed.

#### Option B — New shared generation-domain package plus thin app adapters
- Shape: create a new package for scenarios/jobs/provider abstractions, with `apps/server` and `apps/web` as consumers.
- Pros:
  - Cleaner long-term boundaries.
  - Easier future extraction to multiple services.
- Cons:
  - Upfront abstraction cost before the MVP proves itself.
  - More files/contracts to define before the first working flow.

#### Option C — Separate orchestration service/repo
- Shape: stand up a new service for Runpod/storage orchestration and integrate the current repo around it.
- Pros:
  - Strong isolation and future scalability.
- Cons:
  - Slowest path to value.
  - Operationally unjustified before one working operator flow exists.

### Alternative invalidation rationale
- Option C is invalid for MVP because it adds deployment and coordination complexity before the product workflow is proven.
- Option B is viable, but its upfront abstraction cost is not justified until the first Runpod-backed path is working and the domain seams are validated by real usage.

## ADR

### Decision
Adopt a server-centric MVP in the existing monorepo, but structure new backend code around clear internal modules (`domain`, `registry`, `provider adapters`, `routes`) so it can be extracted later if the surface area grows.

### Drivers
- Existing repo already has the right app surfaces (`apps/server`, `apps/web`) and infrastructure primitives (`packages/db`, `packages/env`).
- MVP scope is intentionally narrow: one workflow path, one operator flow, manual moderation, minimal infra.
- User explicitly allows autonomous architectural tradeoffs and prefers the minimal working path first.

### Alternatives considered
- Introduce a new shared generation package now.
- Create a separate orchestration service/repo.

### Why chosen
This keeps the first iteration close to the current stack, minimizes repo churn, and preserves the fastest path to an operator-usable `ltx-2.3 i2v` scenario flow.

### Consequences
- Backend modularity discipline matters; provider logic cannot be scattered across route handlers.
- Future extraction remains likely once storage sync, multi-region, or training flows arrive.
- Auth remains intentionally absent in MVP, so deployment scope must stay private/admin-only.

### Follow-ups
- Reassess extraction into a shared `generation` package after the first working path is stable.
- Reassess auth and access control before any non-internal rollout.
- Reassess asset replication strategy when more than one region/workflow becomes production-critical.

## Product Goal
Enable internal operators to create reusable generation scenarios and execute them against different input images via serverless Runpod-backed ComfyUI workflows, starting with one verified `ltx-2.3 i2v` path.

## MVP Scope
### In scope
- Scenario CRUD sufficient for one operator workflow path.
- Hardcoded workflow registry for early-stage workflow metadata.
- Serverless Runpod job submission + polling/result retrieval.
- Minimal storage/model-delivery path required by the selected workflow.
- Admin-only UI with no auth in MVP.
- Job status + artifact visibility in the UI.
- End-to-end test/demo flow for `ltx-2.3 i2v`.

### Out of scope
- LoRA training.
- Strong identity consistency guarantees.
- External self-serve or multi-tenant support.
- Billing.
- Full workflow editor.
- Automatic moderation.
- Immediate multi-region replication.

## Proposed Architecture

### Control plane
- **Web app (`apps/web`)**: admin pages/forms for scenario creation, scenario execution, and job/artifact review.
- **API server (`apps/server`)**: Hono routes for scenarios, runs, job status, workflow registry, and health.
- **Database (`packages/db`)**: scenario, scenario run, workflow registry reference, artifact/job metadata.
- **Env contracts (`packages/env`)**: typed env vars for Runpod, storage, and feature flags.

### Internal server modules (inside `apps/server` for MVP)
- `domain/scenarios`: scenario schema + normalization.
- `domain/jobs`: run creation, state transitions, artifact metadata.
- `registry/workflows`: hardcoded workflow definitions and parameter contracts.
- `providers/runpod`: submit/poll/fetch-result adapter.
- `providers/storage`: asset location/lookup/minimal sync abstraction.
- `routes/*`: thin API endpoints over the domain/services.

### Deferred architecture seam
Design adapters/interfaces so these modules can later move into a shared package or separate service without rewriting the UI/API contracts.

## Data model direction
Add tables (or equivalent schema objects) for:
- `workflow_definition` (or hardcoded registry mirrored into app config if DB persistence is deferred)
- `scenario`
- `scenario_input`
- `scenario_run`
- `artifact`
- optional `provider_job_reference`

Minimum persisted fields:
- scenario name, workflow key, prompt, structured params, created/updated timestamps
- run status lifecycle (`queued`, `running`, `succeeded`, `failed`)
- input image reference
- output artifact references
- external provider job ids / error summary

## Delivery Phases

### Phase 0 — Contracts and boundaries
- Freeze the MVP boundary in docs/artifacts.
- Add env contracts for Runpod/storage.
- Define server module layout and scenario/run types.
- Define the hardcoded workflow-registry shape with one `ltx-2.3 i2v` entry.

### Phase 1 — Persistence and backend primitives
- Extend DB schema for scenarios/runs/artifacts.
- Add migration/generation artifacts.
- Implement scenario validation and persistence services.
- Implement workflow-registry read path.

### Phase 2 — Runpod-backed execution path
- Add Runpod adapter with request/response normalization.
- Add minimal storage adapter sufficient for the chosen workflow path.
- Implement run submission, status polling, result ingestion, and failure capture.
- Add server routes for launching and inspecting runs.

### Phase 3 — Admin web flow
- Replace placeholder home screen with operator UI.
- Add scenario creation/edit form.
- Add run-launch flow using a reusable scenario + uploaded input image.
- Add run list/detail/status + artifact links.

### Phase 4 — Verification and operator readiness
- Execute the `ltx-2.3 i2v` path end-to-end.
- Verify repeated runs from one scenario across multiple input images.
- Add operational docs for private/admin-only deployment and env setup.

## Story map / work breakdown
1. **Scenario domain + workflow registry**
2. **DB schema + persistence for scenarios/runs/artifacts**
3. **Runpod adapter + execution orchestration**
4. **Storage/model-delivery adapter for MVP path**
5. **Admin UI for create/run/review**
6. **End-to-end verification + operator runbook**

## File / module touchpoints

### Existing likely touchpoints
- `apps/server/src/index.ts`
- `apps/web/src/app/page.tsx`
- `packages/db/src/index.ts`
- `packages/db/src/schema/*`
- `packages/env/src/server.ts`
- `packages/env/src/web.ts`

### Likely new files/directories
- `apps/server/src/routes/scenarios.ts`
- `apps/server/src/routes/runs.ts`
- `apps/server/src/routes/workflows.ts`
- `apps/server/src/domain/scenarios/*`
- `apps/server/src/domain/jobs/*`
- `apps/server/src/registry/workflows.ts`
- `apps/server/src/providers/runpod.ts`
- `apps/server/src/providers/storage.ts`
- `apps/web/src/app/(admin)/*` or equivalent route structure
- `apps/web/src/components/scenario-form.tsx`
- `apps/web/src/components/run-launcher.tsx`
- `apps/web/src/components/run-list.tsx`
- `packages/db/src/schema/generation.ts`

## Architect review record
### Strongest antithesis
The strongest counterargument is that Runpod orchestration, asset handling, and scenario semantics are a new domain and deserve a dedicated package now; otherwise `apps/server` risks becoming a premature god-service.

### Real tradeoff tension
- **Speed now** vs **clean extraction later**.
- A package-first design is cleaner, but it delays the first working operator path.

### Synthesis applied
Keep the MVP in `apps/server`, but enforce modular subdirectories and adapter boundaries from day one. Avoid route-handler business logic and keep provider access behind dedicated modules. This preserves the extraction seam without paying the full abstraction tax now.

## Critic approval record
### Criteria enforced
- Options were compared fairly.
- Scope is aligned to the clarified MVP, not the original broader ambition.
- Acceptance criteria are testable.
- Verification steps are concrete and tied to the actual product flow.
- Risks and follow-ups are explicit.

### Required revisions applied before approval
- Reduced multi-region/storage ambition from MVP to later-phase follow-up.
- Made `ltx-2.3 i2v` the explicit anchor workflow for proof.
- Added explicit private/admin-only deployment caveat because auth is deferred.

### Final verdict
`APPROVE`

## Acceptance Criteria
1. Operator can create and save a scenario with workflow key, prompt, and reusable parameters.
2. Operator can launch the same scenario against different input images.
3. Backend can submit runs to Runpod, track state, and persist success/failure outcomes.
4. UI can show run status and artifact outputs without requiring manual ComfyUI interaction.
5. One end-to-end `ltx-2.3 i2v` scenario is verifiably runnable through the product surface.
6. MVP success is defined as reliable pipeline execution; human moderation selects acceptable outputs.

## Verification Strategy
- Unit-test scenario validation, workflow registry mapping, run-state transitions, env parsing, and provider payload shaping.
- Integration-test Hono routes with mocked Runpod/storage adapters and DB-backed scenario/run persistence.
- Manual/E2E verify create-scenario → launch-run → observe-status → inspect-artifact for `ltx-2.3 i2v`.
- Capture logs/error states so failed provider runs are diagnosable rather than silent.

## Risks and mitigations
- **Runpod API/endpoint mismatch** → isolate in adapter; mock early; keep payload contract explicit.
- **Asset/model delivery ambiguity** → constrain MVP to one known workflow and only the assets it needs.
- **No-auth admin surface risk** → keep deployment private/internal only; do not expose publicly.
- **Schema drift between scenario params and workflow requirements** → validate scenario payloads against registry-defined param contracts.
- **Async state bugs** → centralize run-state transitions and persist provider job ids/errors.

## Available agent-types roster
- `planner`
- `architect`
- `critic`
- `executor`
- `debugger`
- `test-engineer`
- `verifier`
- `writer`
- `designer`
- `dependency-expert`
- `security-reviewer`
- `code-reviewer`

## Follow-up staffing guidance

### Ralph path (sequential)
Recommended lanes, in order:
1. `executor` — high reasoning — implement server/domain/db/env changes.
2. `executor` — medium/high reasoning — implement web admin flow once backend contracts land.
3. `test-engineer` — medium reasoning — add/expand route/domain/UI verification.
4. `verifier` — high reasoning — confirm acceptance criteria and evidence.
5. `writer` — medium reasoning — operator runbook / env setup notes.

Suggested Ralph launch:
- `$ralph .omx/plans/prd-comfyui-runpod-mvp.md`

### Team path (parallel)
Because current team runtime uses one shared worker role prompt, prefer:
- **Headcount:** 3 workers
- **Launch shape:** `3:executor`
- **Lane allocation:**
  - Worker 1: backend domain/db/routes/runpod adapter
  - Worker 2: web admin UI + client integration
  - Worker 3: verification lane (route tests, mocked adapter tests, operator docs scaffolding)
- **Leader follow-up:** run a final `verifier` pass after worker integration if evidence is incomplete.

Suggested team launch hints:
- `omx team 3:executor "Implement .omx/plans/prd-comfyui-runpod-mvp.md and verify against .omx/plans/test-spec-comfyui-runpod-mvp.md"`
- `$team 3:executor "Implement .omx/plans/prd-comfyui-runpod-mvp.md and verify against .omx/plans/test-spec-comfyui-runpod-mvp.md"`

## Team verification path
1. Worker 1 lands backend contracts and adapter seams.
2. Worker 2 lands scenario/run UI against the agreed server contracts.
3. Worker 3 owns regression/route/manual verification evidence and keeps a running acceptance checklist.
4. Leader integrates, runs repository-level checks, then executes the manual `ltx-2.3 i2v` path.
5. If any acceptance criterion remains unproven, run a separate `verifier` or later `ralph` follow-up before declaring done.
