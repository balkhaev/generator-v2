---
name: backend-debug
description: Debug local and cross-service backend failures across admin, generator, studio, and persons services. Use when the user mentions backend debugging, broken APIs, integration failures, auth gateway issues, or health checks.
---

# Backend Debug Skill

Use this skill when the problem may be in service boot, proxying, auth, routing, or cross-service integration.

## Primary Flow

1. Collect a baseline:

```bash
bun --cwd packages/debug-tools run bundle --include-dashboard --include-studio-snapshot
```

2. Verify public health endpoints:
- admin: `http://localhost:3000/api/health`
- generator: `http://localhost:3005/api/health`
- studio: `http://localhost:3006/api/health`
- persons: `http://localhost:3003/api/health`

3. Validate route ownership and proxy boundaries:
- `apps/admin/src/app.ts`
- `apps/generator/src/app.ts`
- `apps/studio/src/app.ts`
- `apps/persons/src/app.ts`

## Focus Areas

- auth or session gate failures in admin/studio
- proxy misroutes between admin -> studio or admin/studio -> generator
- missing env for inter-service URLs
- transport-shape mismatches between API contracts and handlers
- data-layer failures surfacing as health degradation

## Preferred Tactics

- **Drive everything through MCP.** Используй тулы из `apps/mcp` (HTTP) и `packages/debug-tools` (stdio) вместо ad-hoc curl/psql. Полный гайд — скил `mcp-debug`.
- Если нужного тула нет — сначала добавь его в MCP по инструкции `mcp-debug`, потом дебагай.
- Use repo-local health checks (`service_health` MCP tool) before ad-hoc curl loops.
- Prefer debug MCP tools `admin_dashboard_get` and `studio_snapshot_get` when you need structured snapshots.
- Use `npx hono request` for Hono route validation when a route can be tested in-process.
- When debugging a user-facing failure, trace the exact request path across services instead of checking only the first failing service. Передавай свой `x-debug-correlation-id` через `service_request` и грепай его в логах.
