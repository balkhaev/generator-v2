#!/bin/sh
set -eu

: "${SERVICE_ENTRYPOINT:?SERVICE_ENTRYPOINT is required}"
exec node "$SERVICE_ENTRYPOINT"
