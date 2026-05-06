/* biome-ignore-all lint/suspicious/noConsole: smoke script reports human-readable timeline */
/**
 * Минимальная проба RunPod Pod API.
 *
 * Запуск (dry-run, без реальных вызовов RunPod):
 *   bun run packages/runpod/scripts/smoke-pod.ts -- --dry-run
 *
 * Запуск (live, поднимает реальный pod LTX 2.3 и ждёт MP4 в S3):
 *   RUNPOD_API_KEY=rpa_xxx \
 *   RUNPOD_LTX23_POD_BOOTSTRAP_URL=https://.../pod-bootstrap.sh \
 *   S3_ENDPOINT=... S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
 *   bun run packages/runpod/scripts/smoke-pod.ts -- --live --prompt="cat"
 *
 * При попадании Ctrl-C во время live-прогона скрипт пытается удалить pod.
 */

import { resolveS3StorageConfig } from "@generator/storage";

import { createPodsApi } from "../src/api/pods";
import { createPodEngine } from "../src/engine/pod-engine";
import { TERMINAL_STATUSES } from "../src/engine/status";
import { createRunpodHttpClient } from "../src/http/client";
import { createLtx23VideoWorkflow } from "../src/workflows/ltx-2-3-video";

interface CliArgs {
	dryRun: boolean;
	gpuTypeIds?: string[];
	live: boolean;
	pollIntervalMs: number;
	prompt: string;
	timeoutMs: number;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		dryRun: false,
		live: false,
		pollIntervalMs: 30_000,
		prompt: "a cat dancing in a tutu, cinematic, 4k",
		timeoutMs: 30 * 60 * 1000,
	};
	for (const raw of argv) {
		if (!raw.startsWith("--")) {
			continue;
		}
		const [key, value] = raw.slice(2).split("=", 2);
		switch (key) {
			case "dry-run":
				args.dryRun = true;
				break;
			case "live":
				args.live = true;
				break;
			case "prompt":
				if (value) {
					args.prompt = value;
				}
				break;
			case "gpu":
				if (value) {
					args.gpuTypeIds = value
						.split(",")
						.map((item) => item.trim())
						.filter((item) => item.length > 0);
				}
				break;
			case "poll-ms":
				if (value) {
					args.pollIntervalMs = Number(value);
				}
				break;
			case "timeout-ms":
				if (value) {
					args.timeoutMs = Number(value);
				}
				break;
			default:
				break;
		}
	}
	if (!(args.dryRun || args.live)) {
		args.dryRun = true;
	}
	return args;
}

function logEvent(event: string, fields: unknown = {}): void {
	const stamp = new Date().toISOString();
	console.log(`[${stamp}] ${event}`, fields);
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const apiKey = process.env.RUNPOD_API_KEY;
	const bootstrapUrl = process.env.RUNPOD_LTX23_POD_BOOTSTRAP_URL;
	const imageName =
		process.env.RUNPOD_LTX23_POD_IMAGE_NAME ??
		"ls250824/run-comfyui-ltx:28042026";
	const gpuTypeIdsFromEnv = process.env.RUNPOD_LTX23_POD_GPU_TYPE_IDS?.split(
		","
	)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	const gpuTypeIds = args.gpuTypeIds ??
		gpuTypeIdsFromEnv ?? ["NVIDIA RTX A6000"];

	if (!apiKey) {
		throw new Error("RUNPOD_API_KEY is required");
	}
	if (!bootstrapUrl) {
		throw new Error("RUNPOD_LTX23_POD_BOOTSTRAP_URL is required");
	}

	const s3 = resolveS3StorageConfig();
	const workflow = createLtx23VideoWorkflow({
		hfToken: process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN,
		civitaiApiKey: process.env.CIVITAI_API_KEY,
		pod: {
			bootstrapUrl,
			cloudType: "SECURE",
			containerDiskInGb: 15,
			gpuTypeIds,
			imageName,
			templateId: process.env.RUNPOD_LTX23_POD_TEMPLATE_ID,
			timeoutMs: 30 * 60 * 1000,
			volumeInGb: 90,
		},
	});

	logEvent("smoke.start", {
		dryRun: args.dryRun,
		gpuTypeIds,
		imageName,
		live: args.live,
	});

	if (args.dryRun) {
		const parsed = workflow.inputSchema.parse({ prompt: args.prompt });
		const env = workflow.buildEnv(parsed, {
			logPublicUrl: "https://example.com/log.txt",
			logUploadUrl: "https://example.com/log-put",
			outputContentType: "video/mp4",
			outputPublicUrl: "https://example.com/output.mp4",
			outputUploadUrl: "https://example.com/output-put",
			requestId: "dry-run-request",
			s3,
			timeoutMs: workflow.pod.timeoutMs,
		});
		logEvent("smoke.dry-run.env", {
			keys: Object.keys(env),
			prompt: args.prompt,
		});
		logEvent("smoke.dry-run.dockerStartCmd", {
			value: `bash -lc 'curl -sSfL "${bootstrapUrl}" | bash'`,
		});
		return;
	}

	const http = createRunpodHttpClient({
		apiKey,
		baseUrl:
			process.env.RUNPOD_REST_API_BASE_URL ?? "https://rest.runpod.io/v1",
	});
	const api = createPodsApi(http);
	const engine = createPodEngine({
		api,
		logger: console,
		s3,
		workflow,
	});

	const submission = await engine.submit({ prompt: args.prompt });
	logEvent("smoke.submitted", submission);

	let interrupted = false;
	const onSig = () => {
		if (interrupted) {
			return;
		}
		interrupted = true;
		logEvent("smoke.interrupt", { jobId: submission.jobId });
		engine.cancel(submission.jobId).catch((error: unknown) => {
			logEvent("smoke.cancel.failed", {
				message: error instanceof Error ? error.message : String(error),
			});
		});
	};
	process.on("SIGINT", onSig);
	process.on("SIGTERM", onSig);

	const startedAt = Date.now();
	let attempt = 0;
	let lastStatus = submission.status;
	while (!(interrupted || TERMINAL_STATUSES.has(lastStatus))) {
		if (Date.now() - startedAt > args.timeoutMs) {
			logEvent("smoke.timeout", {
				attempts: attempt,
				lastStatus,
				timeoutMs: args.timeoutMs,
			});
			await engine.cancel(submission.jobId);
			process.exitCode = 1;
			return;
		}
		await sleep(args.pollIntervalMs);
		attempt += 1;
		const status = await engine.getStatus(submission.jobId);
		lastStatus = status.status;
		logEvent("smoke.poll", {
			attempt,
			elapsedMs: Date.now() - startedAt,
			status: status.status,
		});
		if (status.status === "succeeded") {
			logEvent("smoke.success", {
				elapsedMs: Date.now() - startedAt,
				output: status.output,
			});
			return;
		}
		if (status.status === "failed") {
			logEvent("smoke.failed", {
				elapsedMs: Date.now() - startedAt,
				errorSummary: status.errorSummary,
			});
			process.exitCode = 1;
			return;
		}
	}
}

main().catch((error) => {
	logEvent("smoke.error", {
		message: error instanceof Error ? error.message : String(error),
	});
	process.exitCode = 1;
});
