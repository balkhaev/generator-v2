/* biome-ignore-all lint/suspicious/noConsole: smoke script reports human-readable timeline */
/**
 * Минимальная проба RunPod serverless API.
 *
 * Запуск:
 *   RUNPOD_API_KEY=rpa_xxx \
 *   RUNPOD_FOOOCUS_ENDPOINT_ID=xxxxxx \
 *   bun run packages/runpod/scripts/smoke-serverless.ts -- --prompt="cat"
 *
 * По умолчанию шлёт минимальный Fooocus SDXL prompt и поллит /status пока не
 * получит терминальный статус. Можно передать кастомный workflow через
 * флаг `--workflow=health` (тогда payload — `{ ping: true }` без валидации).
 *
 * Скрипт не использует S3, только /v2 queue.
 */

import { z } from "zod";
import { createServerlessApi } from "../src/api/serverless";
import { createServerlessEngine } from "../src/engine/serverless-engine";
import { TERMINAL_STATUSES } from "../src/engine/status";
import { createRunpodHttpClient } from "../src/http/client";
import type { ServerlessWorkflow } from "../src/workflow/definition";
import { createFooocusSdxlWorkflow } from "../src/workflows/fooocus-sdxl";

interface CliArgs {
	endpointId?: string;
	pollIntervalMs: number;
	prompt: string;
	timeoutMs: number;
	workflow: "fooocus" | "raw";
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		pollIntervalMs: 5000,
		prompt: "cinematic studio portrait of a corgi astronaut",
		timeoutMs: 5 * 60 * 1000,
		workflow: "fooocus",
	};
	for (const raw of argv) {
		if (!raw.startsWith("--")) {
			continue;
		}
		const [key, value] = raw.slice(2).split("=", 2);
		switch (key) {
			case "prompt":
				if (value) {
					args.prompt = value;
				}
				break;
			case "endpoint":
				args.endpointId = value;
				break;
			case "workflow":
				if (value === "fooocus" || value === "raw") {
					args.workflow = value;
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
	return args;
}

function logEvent(event: string, fields: unknown = {}): void {
	const stamp = new Date().toISOString();
	console.log(`[${stamp}] ${event}`, fields);
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWorkflow(
	args: CliArgs,
	endpointId: string
): ServerlessWorkflow<unknown, unknown> {
	if (args.workflow === "fooocus") {
		return createFooocusSdxlWorkflow({
			endpointId,
		}) as unknown as ServerlessWorkflow<unknown, unknown>;
	}
	return {
		id: "raw-smoke",
		mode: "serverless",
		endpointId,
		inputSchema: z.unknown() as z.ZodType<unknown>,
		buildPayload: (input) => (input as Record<string, unknown>) ?? {},
		parseOutput: (raw) => raw,
	};
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

	logEvent("smoke.start", {
		endpointId,
		pollIntervalMs: args.pollIntervalMs,
		timeoutMs: args.timeoutMs,
		workflow: args.workflow,
	});

	const http = createRunpodHttpClient({
		apiKey,
		baseUrl: process.env.RUNPOD_API_BASE_URL ?? "https://api.runpod.ai/v2",
	});
	const api = createServerlessApi(http);
	const workflow = buildWorkflow(args, endpointId);
	const engine = createServerlessEngine({ api, workflow });

	const submitInput =
		args.workflow === "fooocus"
			? {
					prompt: args.prompt,
					num_inference_steps: 12,
					image_number: 1,
				}
			: { ping: true };

	const submission = await engine.submit(submitInput as never);
	logEvent("smoke.submitted", submission);

	const startedAt = Date.now();
	let attempt = 0;
	let lastStatus = submission.status;
	while (!TERMINAL_STATUSES.has(lastStatus)) {
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
			progressPct: status.progressPct,
			queuePosition: status.queuePosition,
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
