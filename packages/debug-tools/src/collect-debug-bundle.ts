import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	buildTimestampLabel,
	collectServiceHealth,
	fetchJsonOrText,
	getAdminDebugHeaders,
	getStudioDebugHeaders,
	getWorkspaceRoot,
	resolveWorkspacePath,
	writeJsonFile,
} from "./shared";

interface BundleOptions {
	includeDashboard: boolean;
	includeStudioSnapshot: boolean;
	outputDir?: string;
	services?: string[];
}

const booleanFlagSetters = {
	"--include-dashboard": (options: BundleOptions) => {
		options.includeDashboard = true;
	},
	"--include-studio-snapshot": (options: BundleOptions) => {
		options.includeStudioSnapshot = true;
	},
} as const;

function parseArgs(argv: string[]): BundleOptions {
	const options: BundleOptions = {
		includeDashboard: false,
		includeStudioSnapshot: false,
	};

	for (const argument of argv) {
		const setBooleanFlag =
			booleanFlagSetters[argument as keyof typeof booleanFlagSetters];
		if (setBooleanFlag) {
			setBooleanFlag(options);
			continue;
		}
		if (argument.startsWith("--output-dir=")) {
			options.outputDir = argument.slice("--output-dir=".length);
			continue;
		}
		if (argument.startsWith("--services=")) {
			options.services = argument
				.slice("--services=".length)
				.split(",")
				.map((service) => service.trim())
				.filter((service) => service.length > 0);
		}
	}

	return options;
}

function collectAdminSnapshot(path: string) {
	const url = new URL(path, "http://localhost:3000");
	return fetchJsonOrText(url.toString(), {
		headers: getAdminDebugHeaders(),
	});
}

function collectStudioSnapshot() {
	const url = new URL("/api/studio-snapshot", "http://localhost:3006");
	return fetchJsonOrText(url.toString(), {
		headers: getStudioDebugHeaders(),
	});
}

async function collectBundle(options: BundleOptions) {
	const timestamp = buildTimestampLabel();
	const outputDir =
		options.outputDir ??
		resolveWorkspacePath(".artifacts", "debug-bundles", timestamp);
	await mkdir(outputDir, { recursive: true });

	const summary: Record<string, unknown> = {
		generatedAt: new Date().toISOString(),
		outputDir,
		warnings: [] as string[],
	};

	await writeJsonFile(resolve(outputDir, "workspace-summary.json"), {
		adminCookieConfigured: Boolean(
			process.env.ADMIN_DEBUG_COOKIE ?? process.env.ADMIN_COOKIE
		),
		workspaceRoot: getWorkspaceRoot(),
	});

	const serviceHealth = await collectServiceHealth(options.services);
	await writeJsonFile(resolve(outputDir, "service-health.json"), serviceHealth);
	summary.serviceHealth = serviceHealth;

	if (options.includeDashboard) {
		const dashboard = await collectAdminSnapshot("/api/dashboard");
		await writeJsonFile(resolve(outputDir, "admin-dashboard.json"), dashboard);
		summary.adminDashboard = dashboard;
	}

	if (options.includeStudioSnapshot) {
		const studioSnapshot = await collectStudioSnapshot();
		await writeJsonFile(
			resolve(outputDir, "studio-snapshot.json"),
			studioSnapshot
		);
		summary.studioSnapshot = studioSnapshot;
	}

	await writeJsonFile(resolve(outputDir, "summary.json"), summary);

	return summary;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const summary = await collectBundle(options);
	const output = `${JSON.stringify(summary, null, 2)}\n`;
	const resolvedOutputDir =
		typeof summary.outputDir === "string"
			? summary.outputDir
			: (options.outputDir ??
				resolveWorkspacePath(".artifacts", "debug-bundles"));
	await writeFile(resolve(resolvedOutputDir, "stdout.txt"), output, "utf8");
	process.stdout.write(output);
}

main().catch((error: unknown) => {
	const message =
		error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});
