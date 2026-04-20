import { env } from "@generator/env/server";
import { createAdminTrainingClient } from "@/clients/admin-training";
import { PersonsService } from "@/domain/persons";
import {
	type AdorelyCompanionStatus,
	AdorelyDebugMcpClient,
	importAdorelyCompanions,
} from "@/importers/adorely";
import { createDrizzlePersonsRepository } from "@/repositories/persons";

const args = new Set(process.argv.slice(2));

function readFlag(name: string, envName: string) {
	return args.has(name) || process.env[envName] === "true";
}

function readOptionalNumber(envName: string) {
	const raw = process.env[envName];
	if (!raw) {
		return undefined;
	}
	const value = Number.parseInt(raw, 10);
	return Number.isFinite(value) ? value : undefined;
}

const token =
	process.env.ADORELY_DEBUG_MCP_TOKEN ??
	process.env.ADORELY_INTERNAL_API_TOKEN ??
	process.env.INTERNAL_API_TOKEN;

if (!token) {
	throw new Error(
		"Set ADORELY_DEBUG_MCP_TOKEN or ADORELY_INTERNAL_API_TOKEN before running the Adorely import."
	);
}

const dryRun = !readFlag("--apply", "ADORELY_IMPORT_APPLY");
const startTraining = readFlag("--start-training", "ADORELY_START_TRAINING");
const targetDatasetCount = readOptionalNumber("ADORELY_TARGET_DATASET_COUNT");
const rawStatus = process.env.ADORELY_COMPANION_STATUS ?? "active";

if (
	rawStatus !== "active" &&
	rawStatus !== "archived" &&
	rawStatus !== "draft" &&
	rawStatus !== "pipeline"
) {
	throw new Error(`Unsupported ADORELY_COMPANION_STATUS=${rawStatus}`);
}
const status = rawStatus as AdorelyCompanionStatus;

const service = dryRun
	? undefined
	: new PersonsService({
			adminTrainingClient: env.PERSONS_ADMIN_URL
				? createAdminTrainingClient(
						env.PERSONS_ADMIN_URL,
						env.TRAINING_CONTROL_TOKEN
					)
				: undefined,
			repository: createDrizzlePersonsRepository(),
		});

const mcpUrl = process.env.ADORELY_DEBUG_MCP_URL;
const importOptions = {
	dryRun,
	startTraining,
	status,
	...(service ? { service } : {}),
	...(targetDatasetCount ? { targetDatasetCount } : {}),
};

const summary = await importAdorelyCompanions(
	new AdorelyDebugMcpClient({
		token,
		...(mcpUrl ? { url: mcpUrl } : {}),
	}),
	importOptions
);

console.log(
	JSON.stringify(
		{
			created: summary.created,
			dryRun: summary.dryRun,
			failed: summary.failed,
			imported: summary.imported,
			skipped: summary.skipped,
			startedTraining: summary.startedTraining,
			total: summary.total,
			updated: summary.updated,
			skipReasons: summary.results
				.filter((result) => result.skipped)
				.reduce<Record<string, number>>((counts, result) => {
					const reason = result.skipReason ?? "unknown";
					counts[reason] = (counts[reason] ?? 0) + 1;
					return counts;
				}, {}),
			sample: summary.results.slice(0, 10),
		},
		null,
		2
	)
);

if (summary.failed > 0) {
	process.exitCode = 1;
}
