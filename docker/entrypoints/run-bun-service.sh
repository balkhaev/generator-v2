#!/bin/sh
set -eu

should_run_migrations() {
	case "${RUN_DB_MIGRATIONS:-false}" in
		1|true|TRUE|yes|YES)
			return 0
			;;
		*)
			return 1
			;;
	esac
}

if should_run_migrations; then
	echo "[entrypoint] running database migrations"
	bun packages/db/src/run-migrations.ts
fi

: "${SERVICE_ENTRYPOINT:?SERVICE_ENTRYPOINT is required}"
exec bun "$SERVICE_ENTRYPOINT"
