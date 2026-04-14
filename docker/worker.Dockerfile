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
RUN bun -e 'const file = Bun.file("package.json"); const pkg = JSON.parse(await file.text()); if (pkg.dependencies?.admin) { delete pkg.dependencies.admin; await Bun.write("package.json", `${JSON.stringify(pkg, null, 2)}\n`); } if (await Bun.file("bun.lock").exists()) { await Bun.write("bun.lock", ""); }'
RUN rm -f bun.lock && bun install --production

FROM base AS deps
COPY --from=pruner /tmp/pruned/json/ .
RUN bun -e 'const file = Bun.file("package.json"); const pkg = JSON.parse(await file.text()); if (pkg.dependencies?.admin) { delete pkg.dependencies.admin; await Bun.write("package.json", `${JSON.stringify(pkg, null, 2)}\n`); } if (await Bun.file("bun.lock").exists()) { await Bun.write("bun.lock", ""); }'
RUN rm -f bun.lock && bun install

FROM deps AS builder
COPY --from=pruner /tmp/pruned/full/ .
ARG APP_NAME
RUN bun x turbo run build --filter="${APP_NAME}"

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app

ARG APP_NAME
ARG SERVICE_ENTRYPOINT

ENV NODE_ENV=production
ENV SERVICE_ENTRYPOINT=${SERVICE_ENTRYPOINT}

COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/package.json ./package.json
COPY --from=builder --chown=bun:bun /app/bun.lock ./bun.lock
COPY --from=builder --chown=bun:bun /app/apps/${APP_NAME}/package.json ./apps/${APP_NAME}/package.json
COPY --from=builder --chown=bun:bun /app/apps/${APP_NAME}/dist ./apps/${APP_NAME}/dist
COPY --from=builder --chown=bun:bun /app/packages/db/src/migrations ./packages/db/src/migrations
COPY --from=builder --chown=bun:bun /app/packages/db/src/run-migrations.ts ./packages/db/src/run-migrations.ts
COPY --from=pruner --chown=bun:bun /app/docker/entrypoints/run-bun-service.sh /usr/local/bin/run-bun-service

RUN chmod +x /usr/local/bin/run-bun-service

USER bun

ENTRYPOINT ["/usr/local/bin/run-bun-service"]
