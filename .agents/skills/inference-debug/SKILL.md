---
name: inference-debug
description: Debug the full inference path from workflow selection to generator execution, provider submission, polling, normalization, and artifact extraction. Use when the user mentions inference, executions, workflows, artifacts, failed generations, or output mismatches.
---

# Inference Debug Skill

Use this skill when the failure may be in workflow construction, execution routing, provider dispatch, status normalization, or artifact extraction.

## Primary Flow

1. Start with the plumbing bundle:

```bash
bun --cwd packages/debug-tools run bundle --include-dashboard
```

2. Inspect inference contract boundaries:
- `packages/workflows/src/index.ts`
- `apps/generator/src/domain/executions.ts`
- `apps/generator/src/providers/replicate.ts`

3. Separate failures by stage:
- request build
- submit to provider
- queue / worker boot
- terminal payload normalization
- artifact URL extraction or storage mapping

4. When you need precise remote introspection, use MCP tools (через `apps/mcp` или `packages/debug-tools`, см. скил `mcp-debug`):
- `generator_workflows_get`
- `generator_execution_submit`
- `generator_execution_sync`

Если нужного шага в MCP нет (например, специфичный provider sync, доступ к новой таблице, сэмпл из конкретного Kafka-топика) — добавь tool в `apps/mcp/src/app.ts` по инструкции из `mcp-debug`, не пиши одноразовый bash.

## What Good Looks Like

- workflow params validate before submit
- provider returns a job id and endpoint id
- status transitions map cleanly to app statuses
- terminal output contains artifact URLs or inline artifacts that can be normalized

## Escalation Rule

If the provider API returns errors, check API tokens, rate limits, and model availability before investigating workflow logic.
