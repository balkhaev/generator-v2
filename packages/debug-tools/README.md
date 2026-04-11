# Debug Tools

Repo-local toolkit for end-to-end debugging across:

- Admin / generator / studio / persons backends
- Inference execution path

## Commands

```bash
bun --cwd packages/debug-tools run bundle
bun --cwd packages/debug-tools run bundle --include-dashboard
bun --cwd packages/debug-tools run mcp
```

## What It Does

`bundle`
- collects service health for local backends
- optionally loads the admin dashboard snapshot
- optionally loads the studio snapshot
- writes a timestamped bundle under `.artifacts/debug-bundles/*`

`mcp`
- exposes the same primitives as MCP tools
- gives Codex or another MCP client one place to inspect health and debug bundles

## Optional Env

- `ADMIN_DEBUG_COOKIE` or `ADMIN_COOKIE`
  Used for authenticated admin endpoints like `/api/dashboard`.
- `STUDIO_DEBUG_COOKIE` or `STUDIO_COOKIE`
  Used for authenticated studio endpoints like `/api/studio-snapshot`.

## Output

Bundles are written to `.artifacts/debug-bundles/<timestamp>/` with JSON payloads.
