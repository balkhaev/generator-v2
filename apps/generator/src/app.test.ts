import { describe, expect, it } from "bun:test";

import { createApp } from "@/app";
import type { ExecutionEntity, ExecutionRepository } from "@/domain/executions";

function createMemoryExecutionRepository(): ExecutionRepository {
	const executions = new Map<string, ExecutionEntity>();

	return {
		async createExecution(input) {
			const execution: ExecutionEntity = {
				...input,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			executions.set(execution.id, execution);
			return execution;
		},
		async getExecutionById(executionId) {
			return executions.get(executionId) ?? null;
		},
		async updateExecution(executionId, input) {
			const current = executions.get(executionId);
			if (!current) {
				return null;
			}
			const updated: ExecutionEntity = {
				...current,
				...input,
				updatedAt: new Date(),
			};
			executions.set(executionId, updated);
			return updated;
		},
	};
}

describe("generator api", () => {
	it("submits stateless executions and syncs artifacts", async () => {
		const repository = createMemoryExecutionRepository();
		const inferenceClient = {
			async cancel() {},
			submit(payload: Record<string, unknown>) {
				return Promise.resolve({
					endpointId: "fal-ai/z-image",
					jobId:
						(payload as Record<string, unknown>).__falModel ===
						"fal-ai/z-image/turbo"
							? "job-avatar"
							: "job-other",
					status: "queued" as const,
				});
			},
			getStatus(jobId: string, endpointId?: string) {
				return Promise.resolve({
					endpointId: endpointId ?? "fal-ai/z-image",
					errorSummary: null,
					jobId,
					output: {
						images: [
							{
								url:
									jobId === "job-avatar"
										? "https://cdn.example.com/avatar.png"
										: "https://cdn.example.com/output.png",
								width: 768,
								height: 1024,
							},
						],
					},
					status: "succeeded" as const,
				});
			},
		};
		const backgroundService = new (
			await import("@/domain/executions")
		).ExecutionService(
			repository,
			{
				async enqueueSubmit() {},
				async enqueueSync() {},
			},
			inferenceClient,
			{
				createInputAssetKey(filename) {
					return `https://assets.example.com/${filename}`;
				},
				normalizeInputImageUrl(inputImageUrl) {
					return inputImageUrl;
				},
				normalizeOutputUrl(outputUrl) {
					return outputUrl;
				},
			}
		);
		const app = createApp({
			corsOrigin: "http://localhost:3001",
			executionQueue: {
				async enqueueSubmit({ executionId }) {
					await backgroundService.processExecutionSubmitJob({ executionId });
				},
				async enqueueSync() {},
			},
			executionRepository: repository,
			inferenceClient,
			storageAdapter: {
				createInputAssetKey(filename) {
					return `https://assets.example.com/${filename}`;
				},
				normalizeInputImageUrl(inputImageUrl) {
					return inputImageUrl;
				},
				normalizeOutputUrl(outputUrl) {
					return outputUrl;
				},
			},
		});

		const createResponse = await app.request(
			"http://localhost/api/executions",
			{
				body: JSON.stringify({
					params: { numInferenceSteps: 8 },
					prompt: "beautiful portrait of a woman, natural skin texture",
					workflowKey: "fal-zimage-turbo",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}
		);

		expect(createResponse.status).toBe(201);
		const { execution } = (await createResponse.json()) as {
			execution: {
				id: string;
				providerEndpointId: string | null;
				providerJobId: string | null;
				status: string;
			};
		};
		expect(execution.id).toBeTruthy();
		expect(execution.providerJobId).toBeNull();

		const getResponse = await app.request(
			`http://localhost/api/executions/${execution.id}`
		);
		expect(getResponse.status).toBe(200);
		const { execution: fetchedExecution } = (await getResponse.json()) as {
			execution: {
				providerEndpointId: string | null;
				providerJobId: string | null;
			};
		};
		expect(fetchedExecution.providerJobId).toBe("job-other");

		const syncResponse = await app.request(
			"http://localhost/api/executions/sync",
			{
				body: JSON.stringify({
					providerEndpointId: fetchedExecution.providerEndpointId,
					providerJobId: fetchedExecution.providerJobId,
					workflowKey: "fal-zimage-turbo",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}
		);

		expect(syncResponse.status).toBe(200);
		const { execution: syncedExecution } = (await syncResponse.json()) as {
			execution: {
				artifacts: Array<{ url?: string | null }>;
				status: string;
			};
		};
		expect(syncedExecution.status).toBe("succeeded");
		expect(syncedExecution.artifacts[0]?.url).toBe(
			"https://cdn.example.com/output.png"
		);
	});

	it("rejects executions for unknown workflows", async () => {
		const app = createApp({
			executionQueue: {
				async enqueueSubmit() {},
				async enqueueSync() {},
			},
			executionRepository: createMemoryExecutionRepository(),
			inferenceClient: {
				async cancel() {},
				getStatus() {
					throw new Error("not used");
				},
				submit() {
					throw new Error("not used");
				},
			},
			storageAdapter: {
				createInputAssetKey(filename) {
					return filename;
				},
				normalizeInputImageUrl(inputImageUrl) {
					return inputImageUrl;
				},
				normalizeOutputUrl(outputUrl) {
					return outputUrl;
				},
			},
		});

		const response = await app.request("http://localhost/api/executions", {
			body: JSON.stringify({
				prompt: "test",
				workflowKey: "unknown-workflow",
			}),
			headers: {
				"content-type": "application/json",
			},
			method: "POST",
		});

		expect(response.status).toBe(400);
	});

	it("submits and syncs fal-flux-dev executions through the workflow adapter", async () => {
		const repository = createMemoryExecutionRepository();
		let submittedPayload: Record<string, unknown> | null = null;
		const inferenceClient = {
			async cancel() {},
			submit(payload: Record<string, unknown>) {
				submittedPayload = payload;
				return Promise.resolve({
					endpointId: "fal-ai/flux",
					jobId: "job-flux-dev",
					status: "queued" as const,
				});
			},
			getStatus(jobId: string, endpointId?: string) {
				return Promise.resolve({
					endpointId: endpointId ?? "fal-ai/flux",
					errorSummary: null,
					jobId,
					output: {
						images: [
							{
								url: "https://cdn.example.com/flux-dev.png",
								width: 1024,
								height: 768,
							},
						],
					},
					status: "succeeded" as const,
				});
			},
		};
		const backgroundService = new (
			await import("@/domain/executions")
		).ExecutionService(
			repository,
			{
				async enqueueSubmit() {},
				async enqueueSync() {},
			},
			inferenceClient,
			{
				createInputAssetKey(filename) {
					return filename;
				},
				normalizeInputImageUrl(inputImageUrl) {
					return inputImageUrl;
				},
				normalizeOutputUrl(outputUrl) {
					return outputUrl;
				},
			}
		);
		const app = createApp({
			executionQueue: {
				async enqueueSubmit({ executionId }) {
					await backgroundService.processExecutionSubmitJob({ executionId });
				},
				async enqueueSync() {},
			},
			executionRepository: repository,
			inferenceClient,
			storageAdapter: {
				createInputAssetKey(filename) {
					return filename;
				},
				normalizeInputImageUrl(inputImageUrl) {
					return inputImageUrl;
				},
				normalizeOutputUrl(outputUrl) {
					return outputUrl;
				},
			},
		});

		const createResponse = await app.request(
			"http://localhost/api/executions",
			{
				body: JSON.stringify({
					params: { guidanceScale: 5, numInferenceSteps: 28 },
					prompt: "Preserve the subject identity and add cinematic intimacy.",
					workflowKey: "fal-flux-dev",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}
		);

		expect(createResponse.status).toBe(201);
		const createdExecution = (await createResponse.json()) as {
			execution: { id: string };
		};
		const getResponse = await app.request(
			`http://localhost/api/executions/${createdExecution.execution.id}`
		);
		expect(getResponse.status).toBe(200);
		expect(submittedPayload).toMatchObject({
			__falModel: "fal-ai/flux/dev",
			prompt: "Preserve the subject identity and add cinematic intimacy.",
			guidance_scale: 5,
			num_inference_steps: 28,
		});

		const syncResponse = await app.request(
			"http://localhost/api/executions/sync",
			{
				body: JSON.stringify({
					providerEndpointId: "fal-ai/flux",
					providerJobId: "job-flux-dev",
					workflowKey: "fal-flux-dev",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}
		);

		expect(syncResponse.status).toBe(200);
		const { execution } = (await syncResponse.json()) as {
			execution: {
				artifacts: Array<{ url?: string | null }>;
				status: string;
			};
		};
		expect(execution.status).toBe("succeeded");
		expect(execution.artifacts[0]?.url).toBe(
			"https://cdn.example.com/flux-dev.png"
		);
	});

	it("resubmits executions that stay queued for too long", async () => {
		const staleExecutionId = crypto.randomUUID();
		const repository = {
			createExecution() {
				throw new Error("not used");
			},
			async getExecutionById(executionId: string) {
				if (executionId !== staleExecutionId) {
					return null;
				}

				return {
					artifacts: [],
					callback: null,
					createdAt: new Date(Date.now() - 5 * 60_000),
					errorSummary: null,
					id: staleExecutionId,
					inputImageUrl: null,
					params: {},
					providerEndpointId: "endpoint-old",
					providerJobId: "job-old",
					prompt: "portrait photo of a woman",
					status: "queued" as const,
					updatedAt: new Date(Date.now() - 3 * 60_000),
					workflowKey: "fal-zimage-turbo",
				} satisfies ExecutionEntity;
			},
			async updateExecution(
				_executionId: string,
				input: Partial<ExecutionEntity>
			) {
				return {
					artifacts: [],
					callback: null,
					createdAt: new Date(Date.now() - 5 * 60_000),
					errorSummary: input.errorSummary ?? null,
					id: staleExecutionId,
					inputImageUrl: null,
					params: {},
					providerEndpointId:
						input.providerEndpointId ?? "fal-ai/z-image-resubmitted",
					providerJobId: input.providerJobId ?? "job-resubmitted",
					prompt: "portrait photo of a woman",
					status: (input.status as ExecutionEntity["status"]) ?? "queued",
					updatedAt: new Date(),
					workflowKey: "fal-zimage-turbo",
				} satisfies ExecutionEntity;
			},
		} satisfies ExecutionRepository;
		const enqueuedSyncCalls: string[] = [];
		const inferenceClient = {
			async cancel() {},
			async getStatus() {
				return {
					endpointId: "fal-ai/z-image",
					errorSummary: null,
					jobId: "job-old",
					output: null,
					status: "queued" as const,
				};
			},
			async submit(payload: Record<string, unknown>) {
				expect(payload).toMatchObject({
					__falModel: "fal-ai/z-image/turbo",
				});
				return {
					endpointId: "fal-ai/z-image-resubmitted",
					jobId: "job-resubmitted",
					status: "queued" as const,
				};
			},
		};
		const service = new (await import("@/domain/executions")).ExecutionService(
			repository,
			{
				async enqueueSubmit() {},
				async enqueueSync({ executionId }) {
					enqueuedSyncCalls.push(executionId);
				},
			},
			inferenceClient,
			{
				createInputAssetKey(filename) {
					return filename;
				},
				normalizeInputImageUrl(inputImageUrl) {
					return inputImageUrl;
				},
				normalizeOutputUrl(outputUrl) {
					return outputUrl;
				},
			}
		);

		await service.processExecutionSyncJob({ executionId: staleExecutionId });

		expect(enqueuedSyncCalls).toEqual([staleExecutionId]);
	});

	it("fails executions that remain queued beyond the max queue age", async () => {
		const staleExecutionId = crypto.randomUUID();
		let updatedErrorSummary: string | null = null;
		const repository = {
			createExecution() {
				throw new Error("not used");
			},
			async getExecutionById(executionId: string) {
				if (executionId !== staleExecutionId) {
					return null;
				}

				return {
					artifacts: [],
					callback: null,
					createdAt: new Date(Date.now() - 20 * 60_000),
					errorSummary: null,
					id: staleExecutionId,
					inputImageUrl: null,
					params: {},
					providerEndpointId: "endpoint-old",
					providerJobId: "job-old",
					prompt: "portrait photo of a woman",
					status: "queued" as const,
					updatedAt: new Date(Date.now() - 3 * 60_000),
					workflowKey: "fal-zimage-turbo",
				} satisfies ExecutionEntity;
			},
			async updateExecution(
				_executionId: string,
				input: Partial<ExecutionEntity>
			) {
				updatedErrorSummary = input.errorSummary ?? null;
				return {
					artifacts: [],
					callback: null,
					createdAt: new Date(Date.now() - 20 * 60_000),
					errorSummary: input.errorSummary ?? null,
					id: staleExecutionId,
					inputImageUrl: null,
					params: {},
					providerEndpointId: "fal-ai/z-image",
					providerJobId: "job-old",
					prompt: "portrait photo of a woman",
					status: (input.status as ExecutionEntity["status"]) ?? "failed",
					updatedAt: new Date(),
					workflowKey: "fal-zimage-turbo",
				} satisfies ExecutionEntity;
			},
		} satisfies ExecutionRepository;
		const service = new (await import("@/domain/executions")).ExecutionService(
			repository,
			{
				async enqueueSubmit() {},
				async enqueueSync() {},
			},
			{
				async cancel() {},
				async getStatus() {
					return {
						endpointId: "fal-ai/z-image",
						errorSummary: null,
						jobId: "job-old",
						output: null,
						status: "queued" as const,
					};
				},
				async submit() {
					throw new Error("submit should not be called");
				},
			},
			{
				createInputAssetKey(filename) {
					return filename;
				},
				normalizeInputImageUrl(inputImageUrl) {
					return inputImageUrl;
				},
				normalizeOutputUrl(outputUrl) {
					return outputUrl;
				},
			}
		);

		await service.processExecutionSyncJob({ executionId: staleExecutionId });

		expect(updatedErrorSummary ?? "").toContain("stayed queued too long");
	});
});
