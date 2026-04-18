# syntax=docker/dockerfile:1.7

ARG BUN_IMAGE=oven/bun:1.3.11-alpine

FROM ${BUN_IMAGE} AS base
WORKDIR /app

FROM base AS pruner
COPY . .
ARG APP_NAME
RUN bun x turbo@2.8.12 prune "${APP_NAME}" --docker --out-dir /tmp/pruned

FROM base AS prod-deps
COPY --from=pruner /tmp/pruned/json/ .
RUN rm -f bun.lock && bun install --production
RUN bun -e 'import { existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from "node:fs"; import { dirname, join, relative } from "node:path"; const rootNodeModules = "node_modules"; for (const base of ["apps", "packages"]) { if (!existsSync(base)) continue; for (const entry of readdirSync(base)) { const workspaceNodeModule = join(base, entry, "node_modules"); if (!existsSync(workspaceNodeModule)) continue; for (const dep of readdirSync(workspaceNodeModule)) { if (dep.startsWith(".")) continue; const depPath = realpathSync(join(workspaceNodeModule, dep)); if (dep.startsWith("@")) { const scopeDir = join(rootNodeModules, dep); if (!existsSync(scopeDir)) mkdirSync(scopeDir, { recursive: true }); for (const scopedDep of readdirSync(depPath)) { const src = realpathSync(join(depPath, scopedDep)); const dest = join(scopeDir, scopedDep); if (!existsSync(dest)) symlinkSync(relative(dirname(dest), src), dest); } continue; } const dest = join(rootNodeModules, dep); if (!existsSync(dest)) symlinkSync(relative(dirname(dest), depPath), dest); } } }'

FROM base AS deps
COPY --from=pruner /tmp/pruned/json/ .
RUN rm -f bun.lock && bun install
RUN bun -e 'import { existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from "node:fs"; import { dirname, join, relative } from "node:path"; const rootNodeModules = "node_modules"; for (const base of ["apps", "packages"]) { if (!existsSync(base)) continue; for (const entry of readdirSync(base)) { const workspaceNodeModule = join(base, entry, "node_modules"); if (!existsSync(workspaceNodeModule)) continue; for (const dep of readdirSync(workspaceNodeModule)) { if (dep.startsWith(".")) continue; const depPath = realpathSync(join(workspaceNodeModule, dep)); if (dep.startsWith("@")) { const scopeDir = join(rootNodeModules, dep); if (!existsSync(scopeDir)) mkdirSync(scopeDir, { recursive: true }); for (const scopedDep of readdirSync(depPath)) { const src = realpathSync(join(depPath, scopedDep)); const dest = join(scopeDir, scopedDep); if (!existsSync(dest)) symlinkSync(relative(dirname(dest), src), dest); } continue; } const dest = join(rootNodeModules, dep); if (!existsSync(dest)) symlinkSync(relative(dirname(dest), depPath), dest); } } }'

FROM deps AS builder
COPY --from=pruner /tmp/pruned/full/ .
ARG APP_NAME
RUN bun x turbo run build --filter="${APP_NAME}"

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app

ARG APP_NAME
ARG APP_PORT
ARG SERVICE_ENTRYPOINT

ENV NODE_ENV=production
ENV PORT=${APP_PORT}
ENV SERVICE_ENTRYPOINT=${SERVICE_ENTRYPOINT}

COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/package.json ./package.json
COPY --from=builder --chown=bun:bun /app/bun.lock ./bun.lock
COPY --from=builder --chown=bun:bun /app/apps/${APP_NAME}/package.json ./apps/${APP_NAME}/package.json
COPY --from=builder --chown=bun:bun /app/apps/${APP_NAME}/dist ./apps/${APP_NAME}/dist
# Drizzle SQL migrations are read at runtime by the dedicated `db-migrate`
# service (`apps/db-migrate`). Other API services do not run migrations and
# therefore don't need this folder, but we ship it to all `_api` images for
# simplicity (a few hundred KB of .sql) — db-migrate inherits this Dockerfile
# via docker-bake.hcl. `migrate.ts` itself is bundled into each app's dist.
COPY --from=builder --chown=bun:bun /app/packages/db/src/migrations ./packages/db/src/migrations
COPY --from=pruner --chown=bun:bun /app/docker/entrypoints/run-bun-service.sh /usr/local/bin/run-bun-service

RUN chmod +x /usr/local/bin/run-bun-service

USER bun

EXPOSE ${APP_PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
	CMD bun -e 'const port = process.env.PORT ?? "3000"; const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (!response.ok) process.exit(1);'

ENTRYPOINT ["/usr/local/bin/run-bun-service"]
