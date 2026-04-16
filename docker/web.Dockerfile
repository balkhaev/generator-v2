# syntax=docker/dockerfile:1.7

ARG BUN_IMAGE=oven/bun:1.3.11-alpine
ARG NODE_IMAGE=node:22-alpine

FROM ${BUN_IMAGE} AS base
WORKDIR /app

FROM base AS pruner
COPY . .
ARG APP_NAME
RUN bun x turbo@2.8.12 prune "${APP_NAME}" --docker --out-dir /tmp/pruned

FROM base AS deps
COPY --from=pruner /tmp/pruned/json/ .
RUN rm -f bun.lock && bun install

FROM deps AS builder
COPY --from=pruner /tmp/pruned/full/ .
ARG APP_NAME
ARG NEXT_PUBLIC_ADMIN_URL
ARG NEXT_PUBLIC_PERSONS_API_URL
ARG NEXT_PUBLIC_PERSONS_URL
ARG NEXT_PUBLIC_SERVER_URL
ARG NEXT_PUBLIC_STUDIO_URL
ENV NEXT_PUBLIC_ADMIN_URL=${NEXT_PUBLIC_ADMIN_URL}
ENV NEXT_PUBLIC_PERSONS_API_URL=${NEXT_PUBLIC_PERSONS_API_URL}
ENV NEXT_PUBLIC_PERSONS_URL=${NEXT_PUBLIC_PERSONS_URL}
ENV NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL}
ENV NEXT_PUBLIC_STUDIO_URL=${NEXT_PUBLIC_STUDIO_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun x turbo run build --filter="${APP_NAME}"

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ARG APP_NAME
ARG APP_PORT
ARG SERVICE_ENTRYPOINT
ARG NEXT_PUBLIC_ADMIN_URL
ARG NEXT_PUBLIC_PERSONS_API_URL
ARG NEXT_PUBLIC_PERSONS_URL
ARG NEXT_PUBLIC_SERVER_URL
ARG NEXT_PUBLIC_STUDIO_URL

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=${APP_PORT}
ENV SERVICE_ENTRYPOINT=${SERVICE_ENTRYPOINT}
ENV NEXT_PUBLIC_ADMIN_URL=${NEXT_PUBLIC_ADMIN_URL}
ENV NEXT_PUBLIC_PERSONS_API_URL=${NEXT_PUBLIC_PERSONS_API_URL}
ENV NEXT_PUBLIC_PERSONS_URL=${NEXT_PUBLIC_PERSONS_URL}
ENV NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL}
ENV NEXT_PUBLIC_STUDIO_URL=${NEXT_PUBLIC_STUDIO_URL}

COPY --from=builder /app/apps/${APP_NAME}/.next/standalone ./
COPY --from=builder /app/apps/${APP_NAME}/.next/static ./apps/${APP_NAME}/.next/static
COPY --from=pruner /app/docker/entrypoints/run-node-service.sh /usr/local/bin/run-node-service

RUN chmod +x /usr/local/bin/run-node-service

USER node

EXPOSE ${APP_PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
	CMD node -e 'fetch(`http://127.0.0.1:${process.env.PORT || "3000"}`).then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));'

ENTRYPOINT ["/usr/local/bin/run-node-service"]
