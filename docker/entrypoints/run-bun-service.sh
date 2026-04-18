#!/bin/sh
set -eu

# Backend services no longer run database migrations on startup. Use the
# dedicated `db-migrate` service (apps/db-migrate) — it owns the advisory
# lock, the journal, and the POST /api/migrate trigger.

: "${SERVICE_ENTRYPOINT:?SERVICE_ENTRYPOINT is required}"
exec bun "$SERVICE_ENTRYPOINT"
