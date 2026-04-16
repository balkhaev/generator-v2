import { ExecutionService } from "@/domain/executions";
import { createFalClient } from "@/providers/fal";
import { createInferenceRouter } from "@/providers/inference-router";
import { createStorageAdapter } from "@/providers/storage";
import {
	createGeneratorExecutionQueueClient,
	createGeneratorExecutionWorker,
} from "@/queue/executions";
import { createDrizzleExecutionRepository } from "@/repositories/executions";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const falKey = process.env.FAL_KEY;

if (!falKey) {
	throw new Error("FAL_KEY is required for the generator worker");
}

const inferenceClient = createInferenceRouter({
	fal: createFalClient({ apiKey: falKey }),
});

const service = new ExecutionService(
	createDrizzleExecutionRepository(),
	createGeneratorExecutionQueueClient(redisUrl),
	inferenceClient,
	createStorageAdapter(),
	console
);

const worker = createGeneratorExecutionWorker({
	handler: async (job) => {
		if (job.name === "submit") {
			await service.processExecutionSubmitJob(job.data);
			return;
		}
		await service.processExecutionSyncJob(job.data);
	},
	async onJobExhausted(executionId, error) {
		await service.markExecutionFailed(
			executionId,
			`Queue job failed after retries: ${error.message}`
		);
	},
	redisUrl,
});

await new Promise<void>((resolve) => {
	let isShuttingDown = false;

	const shutdown = async () => {
		if (isShuttingDown) {
			return;
		}

		isShuttingDown = true;
		await worker.close();
		resolve();
	};

	process.on("SIGTERM", () => {
		shutdown().catch((error) => {
			console.error("generator.worker.shutdown.error", {
				message: error instanceof Error ? error.message : "unknown",
			});
		});
	});
	process.on("SIGINT", () => {
		shutdown().catch((error) => {
			console.error("generator.worker.shutdown.error", {
				message: error instanceof Error ? error.message : "unknown",
			});
		});
	});
});
