import { describe, expect, it } from "bun:test";
import { GENERATOR_INTERNAL_TOKEN_HEADER } from "@generator/http/shared";

import { createApp } from "@/app";
import type { ExecutionEntity, ExecutionRepository } from "@/domain/executions";
import type { StorageAdapter } from "@/providers/storage";

function createTestStorageAdapter(): StorageAdapter {
	const persister = {
		isOwnedAssetUrl: () => true,
		persistArtifactUrl({ url }: { url: string }) {
			return Promise.resolve(url);
		},
		persistArtifactUrls({ urls }: { urls: string[] }) {
			return Promise.resolve(urls);
		},
	};
	return {
		artifactPersister: persister,
		normalizeInputImageUrl(url: string) {
			return url;
		},
		persistArtifactUrls({ urls }) {
			return Promise.resolve(urls);
		},
	};
}

function createMemoryExecutionRepository(): ExecutionRepository {
	const executions = new Map<string, ExecutionEntity>();

	return {
		createExecution(input) {
			const execution: ExecutionEntity = {
				...input,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			executions.set(execution.id, execution);
			return Promise.resolve(execution);
		},
		getExecutionById(executionId) {
			return Promise.resolve(executions.get(executionId) ?? null);
		},
		updateExecution(executionId, input) {
			const current = executions.get(executionId);
			if (!current) {
				return Promise.resolve(null);
			}
			const updated: ExecutionEntity = {
				...current,
				...input,
				updatedAt: new Date(),
			};
			executions.set(executionId, updated);
			return Promise.resolve(updated);
		},
	};
}

describe("generator api", () => {
	it("accepts internal-token-authenticated execution requests", async () => {
		const previousInternalToken = process.env.GENERATOR_INTERNAL_TOKEN;
		process.env.GENERATOR_INTERNAL_TOKEN = "internal-token-1";

		try {
			const app = createApp({
				executionQueue: {
					enqueueSubmit() {
						return Promise.resolve();
					},
					enqueueSync() {
						return Promise.resolve();
					},
				},
				executionRepository: createMemoryExecutionRepository(),
				getSession() {
					return Promise.resolve(null);
				},
				inferenceClient: {
					cancel() {
						return Promise.resolve();
					},
					getStatus() {
						throw new Error("not used");
					},
					submit() {
						return Promise.resolve({
							endpointId: "fal-ai/z-image",
							jobId: "job-internal",
							status: "queued" as const,
						});
					},
				},
				storageAdapter: createTestStorageAdapter(),
			});

			const response = await app.request("http://localhost/api/executions", {
				body: JSON.stringify({
					prompt: "test prompt",
					workflowKey: "fal-zimage-turbo",
				}),
				headers: {
					"content-type": "application/json",
					[GENERATOR_INTERNAL_TOKEN_HEADER]: "internal-token-1",
				},
				method: "POST",
			});

			expect(response.status).toBe(201);
		} finally {
			if (previousInternalToken === undefined) {
				process.env.GENERATOR_INTERNAL_TOKEN = undefined;
			} else {
				process.env.GENERATOR_INTERNAL_TOKEN = previousInternalToken;
			}
		}
	});

	it("submits stateless executions and syncs artifacts", async () => {
		const repository = createMemoryExecutionRepository();
		const inferenceClient = {
			cancel() {
				return Promise.resolve();
			},
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
				enqueueSubmit() {
					return Promise.resolve();
				},
				enqueueSync() {
					return Promise.resolve();
				},
			},
			inferenceClient,
			createTestStorageAdapter()
		);
		const app = createApp({
			corsOrigin: "http://localhost:3001",
			executionQueue: {
				async enqueueSubmit({ executionId }) {
					await backgroundService.processExecutionSubmitJob({ executionId });
				},
				enqueueSync() {
					return Promise.resolve();
				},
			},
			executionRepository: repository,
			inferenceClient,
			storageAdapter: createTestStorageAdapter(),
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
		expect(fetchedExecution.providerJobId).toBe("job-avatar");

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
			"https://cdn.example.com/avatar.png"
		);
	});

	it("cancels persisted executions through the provider", async () => {
		const repository = createMemoryExecutionRepository();
		let cancelledJobId = "";
		const inferenceClient = {
			cancel(jobId: string) {
				cancelledJobId = jobId;
				return Promise.resolve();
			},
			submit() {
				return Promise.resolve({
					endpointId: "fal-ai/z-image",
					jobId: "job-cancel",
					status: "queued" as const,
				});
			},
			getStatus() {
				throw new Error("not used");
			},
		};
		const backgroundService = new (
			await import("@/domain/executions")
		).ExecutionService(
			repository,
			{
				enqueueSubmit() {
					return Promise.resolve();
				},
				enqueueSync() {
					return Promise.resolve();
				},
			},
			inferenceClient,
			createTestStorageAdapter()
		);
		const app = createApp({
			executionQueue: {
				async enqueueSubmit({ executionId }) {
					await backgroundService.processExecutionSubmitJob({ executionId });
				},
				enqueueSync() {
					return Promise.resolve();
				},
			},
			executionRepository: repository,
			inferenceClient,
			storageAdapter: createTestStorageAdapter(),
		});

		const createResponse = await app.request(
			"http://localhost/api/executions",
			{
				body: JSON.stringify({
					prompt: "portrait photo of a woman",
					workflowKey: "fal-zimage-turbo",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}
		);
		const { execution: createdExecution } = (await createResponse.json()) as {
			execution: { id: string };
		};

		const cancelResponse = await app.request(
			`http://localhost/api/executions/${createdExecution.id}/cancel`,
			{ method: "POST" }
		);

		expect(cancelResponse.status).toBe(200);
		expect(cancelledJobId).toBe("job-cancel");
		const { execution } = (await cancelResponse.json()) as {
			execution: { errorSummary: string | null; status: string };
		};
		expect(execution.status).toBe("failed");
		expect(execution.errorSummary).toBe("Execution cancelled by operator");
	});

	it("rejects executions for unknown workflows", async () => {
		const app = createApp({
			executionQueue: {
				enqueueSubmit() {
					return Promise.resolve();
				},
				enqueueSync() {
					return Promise.resolve();
				},
			},
			executionRepository: createMemoryExecutionRepository(),
			inferenceClient: {
				cancel() {
					return Promise.resolve();
				},
				getStatus() {
					throw new Error("not used");
				},
				submit() {
					throw new Error("not used");
				},
			},
			storageAdapter: createTestStorageAdapter(),
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
			cancel() {
				return Promise.resolve();
			},
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
				enqueueSubmit() {
					return Promise.resolve();
				},
				enqueueSync() {
					return Promise.resolve();
				},
			},
			inferenceClient,
			createTestStorageAdapter()
		);
		const app = createApp({
			executionQueue: {
				async enqueueSubmit({ executionId }) {
					await backgroundService.processExecutionSubmitJob({ executionId });
				},
				enqueueSync() {
					return Promise.resolve();
				},
			},
			executionRepository: repository,
			inferenceClient,
			storageAdapter: createTestStorageAdapter(),
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
			getExecutionById(executionId: string) {
				if (executionId !== staleExecutionId) {
					return Promise.resolve(null);
				}

				return Promise.resolve({
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
				} satisfies ExecutionEntity);
			},
			updateExecution(_executionId: string, input: Partial<ExecutionEntity>) {
				return Promise.resolve({
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
				} satisfies ExecutionEntity);
			},
		} satisfies ExecutionRepository;
		const enqueuedSyncCalls: string[] = [];
		const inferenceClient = {
			cancel() {
				return Promise.resolve();
			},
			getStatus() {
				return Promise.resolve({
					endpointId: "fal-ai/z-image",
					errorSummary: null,
					jobId: "job-old",
					output: null,
					status: "queued" as const,
				});
			},
			submit(payload: Record<string, unknown>) {
				expect(payload).toMatchObject({
					__falModel: "fal-ai/z-image/turbo",
				});
				return Promise.resolve({
					endpointId: "fal-ai/z-image-resubmitted",
					jobId: "job-resubmitted",
					status: "queued" as const,
				});
			},
		};
		const service = new (await import("@/domain/executions")).ExecutionService(
			repository,
			{
				enqueueSubmit() {
					return Promise.resolve();
				},
				enqueueSync({ executionId }) {
					enqueuedSyncCalls.push(executionId);
					return Promise.resolve();
				},
			},
			inferenceClient,
			createTestStorageAdapter()
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
			getExecutionById(executionId: string) {
				if (executionId !== staleExecutionId) {
					return Promise.resolve(null);
				}

				return Promise.resolve({
					artifacts: [],
					callback: null,
					createdAt: new Date(Date.now() - 20 * 60_000),
					errorSummary: null,
					id: staleExecutionId,
					inputImageUrl: null,
					params: {},
					providerEndpointId: "fal-ai/z-image",
					providerJobId: "job-old",
					prompt: "portrait photo of a woman",
					status: "queued" as const,
					updatedAt: new Date(Date.now() - 3 * 60_000),
					workflowKey: "fal-zimage-turbo",
				} satisfies ExecutionEntity);
			},
			updateExecution(_executionId: string, input: Partial<ExecutionEntity>) {
				updatedErrorSummary = input.errorSummary ?? null;
				return Promise.resolve({
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
				} satisfies ExecutionEntity);
			},
		} satisfies ExecutionRepository;
		const service = new (await import("@/domain/executions")).ExecutionService(
			repository,
			{
				enqueueSubmit() {
					return Promise.resolve();
				},
				enqueueSync() {
					return Promise.resolve();
				},
			},
			{
				cancel() {
					return Promise.resolve();
				},
				getStatus() {
					return Promise.resolve({
						endpointId: "fal-ai/z-image",
						errorSummary: null,
						jobId: "job-old",
						output: null,
						status: "queued" as const,
					});
				},
				submit() {
					return Promise.reject(new Error("submit should not be called"));
				},
			},
			createTestStorageAdapter()
		);

		await service.processExecutionSyncJob({ executionId: staleExecutionId });

		expect(updatedErrorSummary ?? "").toContain("stayed queued too long");
	});
});
