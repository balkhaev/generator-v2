/* biome-ignore-all lint/suspicious/noConsole: warm-up daemon reports human-readable timeline */
/**
 * Долгоживущий warm-up для RunPod serverless endpoint'а — держит хотя бы
 * один worker idle через периодические `/runsync` ping'и. Альтернатива
 * `active workers ≥ 1` в RunPod console: дешевле, но первый запрос всё
 * равно может попасть на FlashBoot вместо настоящего idle.
 *
 * Запуск:
 *   RUNPOD_API_KEY=rpa_xxx \
 *   RUNPOD_FOOOCUS_ENDPOINT_ID=xxxxxx \
 *   bun run packages/runpod/scripts/warmup-serverless.ts
 *
 *   # С кастомным интервалом (мс)
 *   bun run packages/runpod/scripts/warmup-serverless.ts --interval-ms=120000
 *
 *   # Один цикл (полезно из cron)
 *   bun run packages/runpod/scripts/warmup-serverless.ts --once
 */

import { createServerlessApi } from "../src/api/serverless";
import { createServerlessWarmupRunner } from "../src/engine/serverless-warmup";
import { createRunpodHttpClient } from "../src/http/client";
import { createFooocusSdxlWorkflow } from "../src/workflows/fooocus-sdxl";

interface CliArgs {
	endpointId?: string;
	intervalMs: number;
	once: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		intervalMs: 4 * 60 * 1000,
		once: false,
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
			case "interval-ms":
				if (value) {
					args.intervalMs = Number(value);
				}
				break;
			case "once":
				args.once = true;
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
		retry: { maxAttempts: 5 },
	});
	const api = createServerlessApi(http);
	const workflow = createFooocusSdxlWorkflow({
		endpointId,
		enableWarmup: true,
	});

	const runner = createServerlessWarmupRunner({
		api,
		intervalMs: args.intervalMs,
		logger: console,
		observer: {
			onCycle(event) {
				console.log(`[${tsLabel()}] warmup.cycle`, event);
			},
			onError(event) {
				console.warn(`[${tsLabel()}] warmup.error`, {
					phase: event.phase,
					message: event.error.message,
				});
			},
		},
		workflow,
	});

	if (args.once) {
		const event = await runner.runOnce();
		console.log(`[${tsLabel()}] warmup.once.done`, event);
		return;
	}

	runner.start();
	console.log(`[${tsLabel()}] warmup.started`, {
		endpointId,
		intervalMs: args.intervalMs,
	});
	process.on("SIGTERM", () => {
		runner.stop().then(() => process.exit(0));
	});
	process.on("SIGINT", () => {
		runner.stop().then(() => process.exit(0));
	});
}

main().catch((error) => {
	console.error(`[${tsLabel()}] warmup.fatal`, error);
	process.exitCode = 1;
});
