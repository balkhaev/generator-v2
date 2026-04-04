# Test Spec — ComfyUI Runpod Operator MVP

## Source plan
- PRD: `.omx/plans/prd-comfyui-runpod-mvp.md`
- Source spec: `.omx/specs/deep-interview-plan-md.md`

## Verification goal
Prove the MVP operator flow works end-to-end for one concrete workflow (`ltx-2.3 i2v`) while keeping failures diagnosable and the no-auth admin UI constrained to internal use.

## Acceptance matrix

| AC | Requirement | Verification |
| --- | --- | --- |
| AC1 | Save a scenario with workflow key, prompt, reusable params | UI/manual + backend integration test |
| AC2 | Reuse one scenario with different input images | Integration test + manual run evidence |
| AC3 | Submit run to Runpod and track state | Adapter unit tests + route integration tests |
| AC4 | Surface run status and artifacts in UI | UI/manual verification |
| AC5 | Complete one `ltx-2.3 i2v` end-to-end scenario | Manual E2E evidence |
| AC6 | Reliable pipeline execution is enough; human moderator selects output quality | Product/demo signoff checklist |

## Unit tests
1. Scenario schema validation rejects missing/invalid workflow keys and params.
2. Workflow registry lookup returns the `ltx-2.3 i2v` contract and param metadata.
3. Run-state transition helpers prevent invalid status transitions.
4. Runpod adapter normalizes provider request/response/error shapes.
5. Storage adapter path/key resolution is deterministic for the MVP asset flow.
6. Env parsing fails clearly when required Runpod/storage variables are missing.

## Integration tests
1. Create scenario API persists expected DB record.
2. Launch run API creates a run row, calls mocked Runpod adapter, and stores external job id.
3. Status polling/result ingestion updates run + artifact records correctly.
4. Failed provider response persists diagnosable error state.
5. Scenario rerun with a second input image produces a distinct run tied to the same scenario.

## UI / operator-flow verification
1. Operator can open admin page, create a scenario, and see it listed.
2. Operator can launch a run by selecting/uploading an input image.
3. Operator can observe status transitions (`queued/running/succeeded/failed`).
4. Operator can inspect/download/open produced artifacts from the UI.
5. Operator can rerun the same scenario with a different input image.

## Manual E2E checklist
1. Configure env with private/internal endpoints only.
2. Seed or define the hardcoded `ltx-2.3 i2v` workflow registry entry.
3. Start DB, server, and web app.
4. Create a scenario in the UI.
5. Launch a run with input image A and confirm artifact/result visibility.
6. Launch the same scenario with input image B and confirm a second run/result.
7. Capture status, artifact references, and any provider job ids/logs as evidence.

## Observability / diagnostics requirements
- Persist provider job id per run.
- Persist terminal error summary for failed runs.
- Log route-level submission/polling/result-ingestion events.
- Ensure UI exposes failure state instead of silent loading.

## Non-goal checks
These should NOT be required for MVP acceptance:
- LoRA training flow
- public/self-serve auth flow
- multi-region asset replication
- perfect output consistency across all runs
- automated moderation

## Suggested execution order for tests
1. Unit tests for schema/registry/env/adapter state.
2. Integration tests for routes + persistence with mocked adapters.
3. UI/manual verification of operator flow.
4. Manual `ltx-2.3 i2v` E2E evidence capture.
