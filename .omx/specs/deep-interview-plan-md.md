# Deep Interview Spec: plan-md

## Metadata
- Profile: standard
- Context type: brownfield
- Final ambiguity: 19%
- Threshold: 20%
- Rounds: 8
- Context snapshot: `.omx/context/plan-md-20260404T082700Z.md`
- Transcript: `.omx/interviews/plan-md-20260404T083000Z.md`

## Clarity breakdown
| Dimension | Score |
| --- | ---: |
| Intent | 0.78 |
| Outcome | 0.84 |
| Scope | 0.86 |
| Constraints | 0.88 |
| Success | 0.82 |
| Context | 0.60 |

## Intent
Build an internal operator-facing product for generating media files with diffusion models, using ComfyUI workflows executed through serverless Runpod.

## Desired Outcome
Operators can define reusable generation scenarios that bind a workflow and prompt, then run those scenarios against different input images to produce photo/video outputs without manually using ComfyUI.

## In Scope (MVP)
- Minimal working pipeline for one primary workflow path, explicitly including a test run for `ltx-2.3` image-to-video.
- Serverless Runpod integration that can execute ComfyUI workflows and return outputs/status.
- Minimal asset/model delivery needed for the chosen workflow(s).
- Hardcoded workflow registry for early stages.
- API gateway layer between operator-facing surfaces and runtime execution.
- Admin-only UI for creating/running scenarios and reviewing job outputs/status.
- Scenario model that captures at least:
  - chosen workflow
  - prompt
  - reusable parameters
  - repeated execution over different input images
- Human moderation/review of resulting outputs.

## Out of Scope / Non-goals (MVP)
- LoRA training / identity-training pipeline.
- Strong same-face consistency guarantees.
- External self-serve product.
- Authentication/authorization in the first admin interface.
- Advanced moderation automation.
- Billing / multi-tenant support.
- Full workflow editor.
- Advanced analytics.
- Immediate multi-datacenter replication as a hard MVP requirement.

## Decision Boundaries
OMX may choose autonomously for MVP:
- storage/provider implementation details
- workflow registry format
- API gateway shape
- replication/sync strategy
- UI structure
- whether to start with one main region / endpoint before multi-region expansion

External dependency retained:
- User will later provide Runpod access/keys and help wire the relevant MCP integration.

## Constraints
- Existing repo is a brownfield monorepo with likely touchpoints in `apps/server`, `apps/web`, `packages/db`, `packages/env`, and `packages/ui`.
- No existing Runpod/ComfyUI implementation is present yet.
- MVP should optimize for the smallest working end-to-end path first.
- ComfyUI execution must be stable enough for repeated operator-triggered runs.
- Initial system may prioritize operational reliability over output-quality automation.

## Testable Acceptance Criteria
1. An operator can create a scenario that selects a workflow and prompt.
2. The operator can reuse that scenario with multiple input images.
3. The system can submit scenario runs to a serverless Runpod-backed ComfyUI execution path.
4. The system surfaces job state and returns produced media artifacts.
5. At least one end-to-end `ltx-2.3` i2v scenario can be executed through the product flow.
6. The MVP is acceptable if the pipeline reliably produces outputs; a human moderator may choose which outputs are good enough.

## Scenario Semantics
A scenario primarily represents an intended action or motion pattern (for example jumping in place, rotating around self, etc.), expressed through a chosen workflow plus prompt and parameters.

## Assumptions Exposed + Resolutions
- Assumption: “Stable generation” means strong visual consistency.
  - Resolution: not for MVP. Stability means reliable pipeline execution; output selection stays manual.
- Assumption: multi-datacenter replication is required immediately.
  - Resolution: no; first ship the minimal working version.
- Assumption: auth/admin hardening is required in V1.
  - Resolution: no; admin-only interface may start without auth.

## Pressure-pass Findings
An earlier claim about consistent/stable generation was revisited. The clarified result is that MVP scenarios must consistently encode and execute an action pattern, while strong visual identity consistency is deferred to later phases with LoRA-related work.

## Brownfield Evidence vs Inference
### Evidence
- `plan.md` contains the only explicit product outline for this initiative.
- The repo already has `apps/web` and `apps/server` surfaces and shared packages.
- Search found no existing Runpod / ComfyUI code.

### Inference
- The current monorepo is the intended host for the MVP implementation.
- A minimal architecture should likely land across existing web/server/package boundaries instead of a separate standalone repo.

## Technical Context Findings
- Brownfield app structure exists but domain-specific generation infrastructure has not been implemented yet.
- Therefore planning should define new backend/runtime integration surfaces rather than adapting existing generation code.

## Recommended Handoff
Recommended next step: `$ralplan .omx/specs/deep-interview-plan-md.md`

Why:
- Requirements are now sufficiently clarified.
- Architecture and sequencing choices still matter.
- A planning pass should convert this spec into PRD + test-spec artifacts before execution.
