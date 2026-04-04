# ComfyUI Runpod MVP operator runbook

## Scope
This runbook mirrors `.omx/plans/test-spec-comfyui-runpod-mvp.md` and is the manual verification checklist for the first private/admin-only `ltx-2.3 i2v` workflow path.

## Preconditions
- Internal/private deployment only; no public auth exposure.
- Required Runpod/storage env vars are configured for the target environment.
- The `ltx-2.3 i2v` workflow entry is available in the server workflow registry.
- Database, API server, and web app are running against the same environment.

## Manual operator flow
1. Open the admin UI and create a scenario with:
   - workflow key: `ltx-2.3 i2v`
   - prompt text
   - reusable params (for example seed, guidance scale, duration)
2. Confirm the scenario appears in the scenario list.
3. Launch a run with input image A.
4. Observe the run status moving through `queued` -> `running` -> `succeeded` or `failed`.
5. If the run succeeds, capture:
   - scenario id
   - run id
   - provider job id
   - output artifact URLs
6. Launch the same scenario with input image B.
7. Confirm a second run record is created and remains linked to the original scenario.
8. If a run fails, confirm the UI surfaces the terminal error summary instead of a silent loading state.

## Evidence to capture
- Screenshot or recording of scenario creation.
- Screenshot of the scenario list with the saved scenario.
- Screenshot of both run records tied to the same scenario.
- Provider job id(s) for each run.
- Output artifact URLs or downloaded files for successful runs.
- Failure-state screenshot and error summary for any failed run.

## Regression checks
- Scenario data remains unchanged between repeated runs.
- Each input image generates a distinct run row.
- Terminal failures preserve a diagnosable provider error summary.
- Artifact links remain accessible after status sync.

## Non-goals for MVP signoff
Do not block signoff on:
- LoRA training
- public/self-serve auth
- multi-region replication
- perfectly identical outputs across repeated runs
- automated moderation
