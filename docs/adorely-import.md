# Adorely Companion Import

Imports Adorely companions into `persons` as generator Cast people.

The importer reads Adorely through the read-only Debug MCP endpoint:

- `list_companions`
- `get_companion`
- `list_companion_assets`

It does not query the Adorely database directly.

## Command

Dry-run, no writes:

```bash
ADORELY_DEBUG_MCP_TOKEN=... bun run --cwd apps/persons import:adorely
```

Apply imports:

```bash
ADORELY_DEBUG_MCP_TOKEN=... bun run --cwd apps/persons import:adorely --apply
```

Apply and start dataset prep for imported people that have fewer than the
standard 25 dataset photos:

```bash
ADORELY_DEBUG_MCP_TOKEN=... bun run --cwd apps/persons import:adorely --apply --start-training
```

The token can also be supplied as `ADORELY_INTERNAL_API_TOKEN` or
`INTERNAL_API_TOKEN`.

## Behavior

- Imports only female active companions with Adorely `riskLevel=2` by default.
- Skips companions younger than 18 and companions with no image assets.
- Uses Adorely image assets as `PersonGeneration` dataset rows.
- Stores the Adorely source id in `person.metadata.imports.adorely`.
- Re-running the importer updates the same person instead of creating a
  duplicate.
- When training is started, imported dataset rows are passed to admin-worker as
  seed references. The RunPod pod prep path generates only the missing slots up
  to the 25-photo standard.

Useful options:

- `ADORELY_COMPANION_STATUS=active|draft|pipeline|archived`
- `ADORELY_TARGET_DATASET_COUNT=25`
- `ADORELY_DEBUG_MCP_URL=https://api.adorely.co/debug/mcp`
- `ADORELY_IMPORT_APPLY=true`
- `ADORELY_START_TRAINING=true`
