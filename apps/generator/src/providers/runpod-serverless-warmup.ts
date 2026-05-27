import {
	type AnyWorkflowDefinition,
	createRunpodHttpClient,
	createServerlessApi,
	createServerlessWarmupRunner,
	type ServerlessWarmupRunner,
	type ServerlessWorkflow,
} from "@generator/runpod";

const DEFAULT_WARMUP_INTERVAL_MS = 3 * 60 * 1000;
const MIN_WARMUP_INTERVAL_MS = 60_000;

function readWarmupIntervalMs(): number {
	const raw = process.env.RUNPOD_LTX23_WARMUP_INTERVAL_MS;
	if (!raw) {
		return DEFAULT_WARMUP_INTERVAL_MS;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < MIN_WARMUP_INTERVAL_MS) {
		return DEFAULT_WARMUP_INTERVAL_MS;
	}
	return parsed;
}

function isServerlessWorkflowWithWarmup(
	workflow: AnyWorkflowDefinition
): workflow is ServerlessWorkflow<unknown, unknown> {
	return workflow.mode === "serverless" && workflow.warmup !== undefined;
}

/**
 * Запускает фоновые warm-up циклы для serverless workflow'ов с `warmup`.
 * При `workersMin ≥ 1` циклы чаще skip'аются (idle worker уже есть), но
 * поднимают worker после crash/redeploy.
 */
export function startRunpodServerlessWarmupRunners(options: {
	apiKey: string;
	baseUrl: string;
	logger: Pick<Console, "info" | "warn" | "error">;
	workflows: AnyWorkflowDefinition[];
}): ServerlessWarmupRunner[] {
	if (process.env.RUNPOD_SERVERLESS_WARMUP_ENABLED === "false") {
		return [];
	}

	const warmWorkflows = options.workflows.filter(
		isServerlessWorkflowWithWarmup
	);
	if (warmWorkflows.length === 0) {
		return [];
	}

	const http = createRunpodHttpClient({
		apiKey: options.apiKey,
		baseUrl: options.baseUrl,
		retry: { maxAttempts: 5 },
	});
	const api = createServerlessApi(http);
	const intervalMs = readWarmupIntervalMs();
	const runners: ServerlessWarmupRunner[] = [];

	for (const workflow of warmWorkflows) {
		const runner = createServerlessWarmupRunner({
			api,
			intervalMs,
			logger: options.logger,
			observer: {
				onCycle(event) {
					options.logger.info?.("generator.worker.runpod-warmup.cycle", {
						durationMs: event.durationMs,
						endpointId: workflow.endpointId,
						pinged: event.pinged,
						skippedReason: event.skippedReason,
						workflowId: workflow.id,
						workers: event.health.workers,
					});
				},
				onError(event) {
					options.logger.warn?.("generator.worker.runpod-warmup.error", {
						endpointId: workflow.endpointId,
						message: event.error.message,
						phase: event.phase,
						workflowId: workflow.id,
					});
				},
			},
			workflow,
		});
		runner.start();
		runners.push(runner);
		options.logger.info?.("generator.worker.runpod-warmup.started", {
			endpointId: workflow.endpointId,
			intervalMs,
			workflowId: workflow.id,
		});
	}

	return runners;
}

export async function stopRunpodServerlessWarmupRunners(
	runners: ServerlessWarmupRunner[]
): Promise<void> {
	await Promise.all(runners.map((runner) => runner.stop()));
}
