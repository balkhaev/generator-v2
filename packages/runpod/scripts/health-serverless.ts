/* biome-ignore-all lint/suspicious/noConsole: diagnostic script reports human-readable timeline */
/**
 * Снимок состояния RunPod serverless endpoint'а: `/health` + assessment +
 * опциональная проба `/runsync` мини-prompt'ом для конкретного workflow.
 *
 * Запуск:
 *   RUNPOD_API_KEY=rpa_xxx \
 *   RUNPOD_FOOOCUS_ENDPOINT_ID=xxxxxx \
 *   bun run packages/runpod/scripts/health-serverless.ts
 *
 *   # С тестовым пингом
 *   bun run packages/runpod/scripts/health-serverless.ts --ping
 *
 *   # На другом endpoint'е
 *   bun run packages/runpod/scripts/health-serverless.ts --endpoint=ENDPOINT_ID
 */

import { createServerlessApi } from "../src/api/serverless";
import { assessEndpointHealth } from "../src/engine/serverless-health";
import { createRunpodHttpClient } from "../src/http/client";
import { createFooocusSdxlWorkflow } from "../src/workflows/fooocus-sdxl";

interface CliArgs {
	endpointId?: string;
	ping: boolean;
	waitMs: number;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		ping: false,
		waitMs: 30_000,
	};
	for (const raw of argv) {
		if (!raw.startsWith("--")) {
			continue;
		}
		const [key, value] = raw.slice(2).split("=", 2);
		switch (key) {
			case "endpoint":
				args.endpointId = value;
				break;
			case "ping":
				args.ping = true;
				break;
			case "wait-ms":
				if (value) {
					args.waitMs = Number(value);
				}
				break;
			default:
				break;
		}
	}
	return args;
}

function tsLabel(): string {
	return new Date().toISOString();
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const apiKey = process.env.RUNPOD_API_KEY;
	if (!apiKey) {
		throw new Error("RUNPOD_API_KEY is required");
	}
	const endpointId =
		args.endpointId ?? process.env.RUNPOD_FOOOCUS_ENDPOINT_ID ?? null;
	if (!endpointId) {
		throw new Error(
			"--endpoint=<id> or RUNPOD_FOOOCUS_ENDPOINT_ID env var is required"
		);
	}

	const http = createRunpodHttpClient({
		apiKey,
		baseUrl: process.env.RUNPOD_API_BASE_URL ?? "https://api.runpod.ai/v2",
	});
	const api = createServerlessApi(http);

	console.log(`[${tsLabel()}] health.start`, { endpointId });

	const health = await api.getHealth({ endpointId });
	console.log(`[${tsLabel()}] health.snapshot`, health);

	const assessment = assessEndpointHealth(health);
	console.log(`[${tsLabel()}] health.assessment`, {
		healthy: assessment.healthy,
		maxSeverity: assessment.maxSeverity,
	});
	for (const finding of assessment.findings) {
		const tag = `[${finding.severity.toUpperCase()}]`;
		console.log(
			`  ${tag} ${finding.code}: ${finding.message}\n      → ${finding.recommendation}`
		);
	}

	if (!args.ping) {
		return;
	}

	const workflow = createFooocusSdxlWorkflow({
		endpointId,
		enableWarmup: true,
	});
	if (!workflow.warmup) {
		throw new Error("fooocus workflow has no warmup configuration");
	}
	const payload = workflow.buildPayload(workflow.warmup.buildInput());
	console.log(`[${tsLabel()}] ping.start`, { waitMs: args.waitMs });
	const startedAt = Date.now();
	const result = await api.runSync({
		endpointId,
		input: payload,
		policy: {
			executionTimeout: 60_000,
			lowPriority: true,
			ttl: 5 * 60_000,
		},
		waitMs: args.waitMs,
	});
	console.log(`[${tsLabel()}] ping.result`, {
		elapsedMs: Date.now() - startedAt,
		jobId: result.jobId,
		rawStatus: result.rawStatus,
		delayTimeMs: result.delayTimeMs,
		executionTimeMs: result.executionTimeMs,
	});

	const after = await api.getHealth({ endpointId });
	console.log(`[${tsLabel()}] health.after-ping`, after);
}

main().catch((error) => {
	console.error(`[${tsLabel()}] health.fatal`, error);
	process.exitCode = 1;
});
