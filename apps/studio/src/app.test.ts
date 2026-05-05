import { describe, expect, it } from "bun:test";
import type { LoraRegistryEntry } from "@generator/contracts/loras";
import type { StudioRunDebugBundle } from "@generator/contracts/studio";
import type { LoraReadRepository } from "@generator/db/repositories/lora-read";
import { GENERATOR_INTERNAL_TOKEN_HEADER } from "@generator/http/shared";
import type { S3StorageConfig } from "@generator/storage";

import { createApp } from "@/app";

const fakeS3Config: S3StorageConfig = {
	accessKeyId: "test-key",
	bucket: "test-bucket",
	endpoint: "https://s3.example.com",
	publicBaseUrl: "https://cdn.example.com",
	region: "us-east-1",
	secretAccessKey: "test-secret",
};

import type {
	StudioArtifactEntity,
	StudioExecutionClient,
	StudioRepository,
	StudioRunEntity,
	StudioScenarioEntity,
	StudioShotEntity,
} from "@/domain/studio";

function createMemoryRepository(): StudioRepository {
	const scenarios = new Map<string, StudioScenarioEntity>();
	const runs = new Map<string, StudioRunEntity>();
	const artifacts = new Map<string, StudioArtifactEntity[]>();
	const shots = new Map<string, StudioShotEntity>();

	return {
		createRun(input) {
			const run: StudioRunEntity = {
				...input,
				artifacts: [],
				completedAt: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			runs.set(run.id, run);
			artifacts.set(run.id, []);
			return Promise.resolve(run);
		},
		createScenario(input) {
			const scenario: StudioScenarioEntity = {
				...input,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			scenarios.set(scenario.id, scenario);
			return Promise.resolve(scenario);
		},
		deleteScenario(scenarioId) {
			return Promise.resolve(scenarios.delete(scenarioId));
		},
		getRunByGeneratorRunId(generatorRunId) {
			return Promise.resolve(
				[...runs.values()].find(
					(run) => run.generatorRunId === generatorRunId
				) ?? null
			);
		},
		getRunById(runId) {
			const run = runs.get(runId);
			return Promise.resolve(
				run ? { ...run, artifacts: artifacts.get(runId) ?? [] } : null
			);
		},
		getScenarioByGeneratorScenarioId(generatorScenarioId) {
			return Promise.resolve(
				[...scenarios.values()].find(
					(scenario) => scenario.generatorScenarioId === generatorScenarioId
				) ?? null
			);
		},
		getScenarioById(scenarioId) {
			return Promise.resolve(scenarios.get(scenarioId) ?? null);
		},
		listRuns() {
			return Promise.resolve(
				[...runs.values()].map((run) => ({
					...run,
					artifacts: artifacts.get(run.id) ?? [],
				}))
			);
		},
		listActiveRuns(limit) {
			return Promise.resolve(
				[...runs.values()]
					.filter((run) => run.status === "queued" || run.status === "running")
					.map((run) => ({
						...run,
						artifacts: artifacts.get(run.id) ?? [],
					}))
					.slice(0, limit)
			);
		},
		listScenarios() {
			return Promise.resolve([...scenarios.values()]);
		},
		replaceArtifacts(runId, nextArtifacts) {
			const storedArtifacts = nextArtifacts.map((artifact) => ({
				...artifact,
				createdAt: new Date(),
			}));
			artifacts.set(runId, storedArtifacts);
			return Promise.resolve(storedArtifacts);
		},
		updateRun(runId, input) {
			const current = runs.get(runId);
			if (!current) {
				return Promise.resolve(null);
			}
			const updated: StudioRunEntity = {
				...current,
				...input,
				artifacts: artifacts.get(runId) ?? [],
				completedAt:
					input.completedAt === undefined
						? current.completedAt
						: input.completedAt,
				updatedAt: new Date(),
			};
			runs.set(runId, updated);
			return Promise.resolve(updated);
		},
		updateScenario(scenarioId, input) {
			const current = scenarios.get(scenarioId);
			if (!current) {
				return Promise.resolve(null);
			}
			const updated: StudioScenarioEntity = {
				...current,
				...input,
				updatedAt: new Date(),
			};
			scenarios.set(scenarioId, updated);
			return Promise.resolve(updated);
		},
		createShot(input) {
			const shot: StudioShotEntity = {
				...input,
				createdAt: new Date(),
			};
			shots.set(shot.id, shot);
			return Promise.resolve(shot);
		},
		deleteShot(shotId) {
			return Promise.resolve(shots.delete(shotId));
		},
		listShots() {
			return Promise.resolve(
				[...shots.values()].sort(
					(a, b) => b.createdAt.getTime() - a.createdAt.getTime()
				)
			);
		},
	};
}

function createExecutionClientStub(
	overrides?: Partial<StudioExecutionClient>
): StudioExecutionClient {
	return {
		createExecution(input) {
			return Promise.resolve({
				artifacts: [],
				errorSummary: null,
				id: "execution-1",
				inputImageUrl: input.inputImageUrl ?? "",
				providerEndpointId: null,
				providerJobId: null,
				status: "queued",
				workflowKey: input.workflowKey,
			});
		},
		getExecution() {
			return Promise.resolve({
				artifacts: [{ url: "https://cdn.example.com/output.mp4" }],
				errorSummary: null,
				id: "execution-1",
				inputImageUrl: "",
				providerEndpointId: "endpoint-1",
				providerJobId: "job-1",
				status: "succeeded",
				workflowKey: "fal-zimage-turbo",
			});
		},
		syncExecution(input) {
			return Promise.resolve({
				artifacts: [{ url: "https://cdn.example.com/output.mp4" }],
				errorSummary: null,
				id: input.providerJobId,
				inputImageUrl: "",
				providerEndpointId: input.providerEndpointId ?? "endpoint-1",
				providerJobId: input.providerJobId,
				status: "succeeded",
				workflowKey: input.workflowKey,
			});
		},
		...overrides,
	};
}

describe("studio backend", () => {
	it("rejects protected routes when session is missing", async () => {
		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve(null);
			},
			repository: createMemoryRepository(),
			s3Config: fakeS3Config,
		});

		const response = await app.request("http://localhost/api/scenarios");
		expect(response.status).toBe(401);
	});

	it("accepts protected scenario routes with the internal token", async () => {
		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve(null);
			},
			internalToken: "studio-internal-token",
			repository: createMemoryRepository(),
			s3Config: fakeS3Config,
		});

		const response = await app.request("http://localhost/api/scenarios", {
			headers: {
				[GENERATOR_INTERNAL_TOKEN_HEADER]: "studio-internal-token",
			},
		});

		expect(response.status).toBe(200);
	});

	it("proxies LoRA preview and import requests to admin API", async () => {
		const calls: Array<{
			body: string | null;
			headers: Headers;
			url: string;
		}> = [];
		const loraEntry: LoraRegistryEntry = {
			baseModel: "flux",
			createdAt: new Date().toISOString(),
			defaultWeight: 1,
			description: "Imported style",
			id: "lora-imported",
			name: "Imported LoRA",
			pairGroupId: null,
			s3Key: "loras/imported.safetensors",
			s3Url: "https://cdn.example.com/loras/imported.safetensors",
			sizeBytes: 2048,
			slug: "imported-lora",
			sourceProvider: "civitai",
			sourceUrl: "https://civitai.com/models/42",
			status: "active",
			triggerWords: ["imported"],
			updatedAt: new Date().toISOString(),
			variant: null,
		};
		const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);
			calls.push({
				body: typeof init?.body === "string" ? init.body : null,
				headers: new Headers(init?.headers),
				url,
			});
			if (url.endsWith("/api/admin/loras/preview")) {
				return Promise.resolve(
					Response.json({
						preview: {
							baseModel: "flux",
							downloadUrl: "https://civitai.com/api/download/42",
							name: "Imported LoRA",
							provider: "civitai",
							sourceUrl: "https://civitai.com/models/42",
						},
					})
				);
			}
			return Promise.resolve(
				Response.json({ lora: loraEntry }, { status: 201 })
			);
		};
		const { app } = createApp({
			adminApiBaseUrl: "http://admin.internal/",
			adminInternalToken: "training-token",
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			fetchImpl,
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository: createMemoryRepository(),
			s3Config: fakeS3Config,
		});

		const previewResponse = await app.request(
			"http://localhost/api/loras/preview",
			{
				body: JSON.stringify({ sourceUrl: "https://civitai.com/models/42" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}
		);
		expect(previewResponse.status).toBe(200);
		expect(await previewResponse.json()).toEqual({
			preview: {
				baseModel: "flux",
				downloadUrl: "https://civitai.com/api/download/42",
				name: "Imported LoRA",
				provider: "civitai",
				sourceUrl: "https://civitai.com/models/42",
			},
		});

		const importResponse = await app.request(
			"http://localhost/api/loras/import",
			{
				body: JSON.stringify({
					baseModel: "flux",
					sourceUrl: "https://civitai.com/models/42",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}
		);

		expect(importResponse.status).toBe(201);
		expect(await importResponse.json()).toEqual({ lora: loraEntry });
		expect(calls.map((call) => call.url)).toEqual([
			"http://admin.internal/api/admin/loras/preview",
			"http://admin.internal/api/admin/loras",
		]);
		expect(calls[0]?.headers.get("authorization")).toBe(
			"Bearer training-token"
		);
		expect(calls[1]?.headers.get("authorization")).toBe(
			"Bearer training-token"
		);
	});

	it("creates local scenarios and delegates execution to generator", async () => {
		const repository = createMemoryRepository();
		const calls: string[] = [];
		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub({
				createExecution(input) {
					calls.push(`create:${input.workflowKey}`);
					return Promise.resolve({
						artifacts: [],
						errorSummary: null,
						id: "execution-1",
						inputImageUrl: input.inputImageUrl ?? "",
						providerEndpointId: "endpoint-1",
						providerJobId: "job-1",
						status: "running",
						workflowKey: input.workflowKey,
					});
				},
				getExecution() {
					calls.push("get:fal-zimage-turbo");
					return Promise.resolve({
						artifacts: [{ url: "https://cdn.example.com/output.mp4" }],
						errorSummary: null,
						id: "execution-1",
						inputImageUrl: "",
						providerEndpointId: "endpoint-1",
						providerJobId: "job-1",
						status: "succeeded",
						workflowKey: "fal-zimage-turbo",
					});
				},
				syncExecution(input) {
					calls.push(`sync:${input.providerJobId}`);
					return Promise.resolve({
						artifacts: [{ url: "https://cdn.example.com/output.mp4" }],
						errorSummary: null,
						id: input.providerJobId,
						inputImageUrl: "",
						providerEndpointId: input.providerEndpointId ?? "endpoint-1",
						providerJobId: input.providerJobId,
						status: "succeeded",
						workflowKey: input.workflowKey,
					});
				},
			}),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository,
			s3Config: fakeS3Config,
		});

		const scenarioResponse = await app.request(
			"http://localhost/api/scenarios",
			{
				body: JSON.stringify({
					name: "Studio scenario",
					params: { steps: 12 },
					prompt: "Generate a cinematic clip",
					workflowKey: "fal-zimage-turbo",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}
		);
		expect(scenarioResponse.status).toBe(201);
		const { scenario } = (await scenarioResponse.json()) as {
			scenario: StudioScenarioEntity;
		};

		const runResponse = await app.request("http://localhost/api/runs", {
			body: JSON.stringify({
				inputImageUrl: "https://assets.example.com/input.png",
				scenarioId: scenario.id,
			}),
			headers: {
				"content-type": "application/json",
			},
			method: "POST",
		});
		expect(runResponse.status).toBe(201);
		const { run } = (await runResponse.json()) as { run: StudioRunEntity };
		expect(run.providerJobId).toBe("job-1");

		const syncResponse = await app.request(
			`http://localhost/api/runs/${run.id}/sync`,
			{ method: "POST" }
		);
		expect(syncResponse.status).toBe(200);
		const { run: syncedRun } = (await syncResponse.json()) as {
			run: StudioRunEntity;
		};
		expect(syncedRun.status).toBe("succeeded");
		expect(syncedRun.artifacts[0]?.url).toBe(
			"https://cdn.example.com/output.mp4"
		);
		expect(calls).toEqual(["create:fal-zimage-turbo", "sync:job-1"]);
	});

	it("launches prompt-only video scenarios without an input image", async () => {
		const repository = createMemoryRepository();
		const receivedInputUrls: Array<string | undefined> = [];
		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub({
				createExecution(input) {
					receivedInputUrls.push(input.inputImageUrl);
					return Promise.resolve({
						artifacts: [],
						errorSummary: null,
						id: "execution-video-1",
						inputImageUrl: input.inputImageUrl ?? "",
						providerEndpointId: "fal-ai/ltx-2.3/text-to-video",
						providerJobId: "job-video-1",
						status: "queued",
						workflowKey: input.workflowKey,
					});
				},
			}),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository,
			s3Config: fakeS3Config,
		});

		const scenarioResponse = await app.request(
			"http://localhost/api/scenarios",
			{
				body: JSON.stringify({
					name: "Prompt-only video",
					params: { numFrames: 121, fps: 24 },
					prompt: "Generate a cinematic street clip",
					workflowKey: "fal-ltx-2-3-text-to-video",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}
		);
		const { scenario } = (await scenarioResponse.json()) as {
			scenario: StudioScenarioEntity;
		};

		const runResponse = await app.request("http://localhost/api/runs", {
			body: JSON.stringify({
				scenarioId: scenario.id,
			}),
			headers: {
				"content-type": "application/json",
			},
			method: "POST",
		});

		expect(runResponse.status).toBe(201);
		const { run } = (await runResponse.json()) as { run: StudioRunEntity };
		expect(run.inputImageUrl).toBe("");
		expect(run.providerJobId).toBe("job-video-1");
		expect(receivedInputUrls).toEqual([undefined]);
	});

	it("rejects image-conditioned workflows without an input image", async () => {
		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository: createMemoryRepository(),
			s3Config: fakeS3Config,
		});

		const scenarioResponse = await app.request(
			"http://localhost/api/scenarios",
			{
				body: JSON.stringify({
					name: "Image-conditioned video",
					params: {},
					prompt: "Use the reference image",
					workflowKey: "fal-flux2-dev-edit",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}
		);
		const { scenario } = (await scenarioResponse.json()) as {
			scenario: StudioScenarioEntity;
		};

		const runResponse = await app.request("http://localhost/api/runs", {
			body: JSON.stringify({
				scenarioId: scenario.id,
			}),
			headers: {
				"content-type": "application/json",
			},
			method: "POST",
		});

		expect(runResponse.status).toBe(400);
		expect(await runResponse.json()).toEqual({
			error: "Workflow fal-flux2-dev-edit requires an input image URL",
		});
	});

	it("uploads input images directly to the configured S3 bucket", async () => {
		const writes: Array<{ key: string; size: number }> = [];
		const fakeS3Client = {
			file() {
				throw new Error("not used");
			},
			write(key: string, body: Blob | File) {
				writes.push({ key, size: body.size });
				return Promise.resolve(body.size);
			},
		};
		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository: createMemoryRepository(),
			s3Client: fakeS3Client as never,
			s3Config: fakeS3Config,
		});
		const formData = new FormData();

		formData.set(
			"file",
			new File(["studio-image"], "studio-shot.png", { type: "image/png" })
		);

		const uploadResponse = await app.request(
			"http://localhost/api/input-assets",
			{
				body: formData,
				method: "POST",
			}
		);

		expect(uploadResponse.status).toBe(201);
		const { upload } = (await uploadResponse.json()) as {
			upload: { storage: string; url: string };
		};
		expect(upload.storage).toBe("s3");
		expect(upload.url.startsWith(`${fakeS3Config.publicBaseUrl}/`)).toBe(true);
		expect(upload.url).toContain("studio-inputs/");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.key.startsWith("studio-inputs/")).toBe(true);
	});

	it("prepends LoRA trigger words to the prompt sent to the generator", async () => {
		const repository = createMemoryRepository();
		await repository.createScenario({
			generatorScenarioId: null,
			id: "scenario-trigger",
			name: "Trigger scenario",
			params: {
				loraUrl: "https://cdn.example.com/loras/mystic.safetensors",
				loraWeight: 1,
			},
			prompt: "a quiet street at night",
			workflowKey: "fal-flux-dev",
		});

		const loraEntry: LoraRegistryEntry = {
			baseModel: "flux",
			createdAt: new Date().toISOString(),
			defaultWeight: 1,
			description: "",
			id: "lora-mystic",
			name: "Mystic",
			pairGroupId: null,
			s3Key: "loras/mystic.safetensors",
			s3Url: "https://cdn.example.com/loras/mystic.safetensors",
			sizeBytes: 1024,
			slug: "mystic",
			sourceUrl: null,
			status: "active",
			triggerWords: ["mystic", "neon city"],
			updatedAt: new Date().toISOString(),
			variant: null,
		};
		const loraReadRepository: LoraReadRepository = {
			getById: () => Promise.resolve(null),
			getByPairGroupId: () => Promise.resolve([]),
			getByS3Urls: (urls) =>
				Promise.resolve(urls.includes(loraEntry.s3Url) ? [loraEntry] : []),
			getBySlug: () => Promise.resolve(null),
			list: () => Promise.resolve([loraEntry]),
		};

		const promptsSeen: string[] = [];
		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub({
				createExecution(input) {
					promptsSeen.push(input.prompt ?? "");
					return Promise.resolve({
						artifacts: [],
						errorSummary: null,
						id: "execution-trigger",
						inputImageUrl: input.inputImageUrl ?? "",
						providerEndpointId: null,
						providerJobId: null,
						status: "queued",
						workflowKey: input.workflowKey,
					});
				},
			}),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			loraReadRepository,
			repository,
			s3Config: fakeS3Config,
		});

		const runResponse = await app.request("http://localhost/api/runs", {
			body: JSON.stringify({ scenarioId: "scenario-trigger" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		expect(runResponse.status).toBe(201);
		expect(promptsSeen).toHaveLength(1);
		expect(promptsSeen[0]).toBe("mystic, neon city, a quiet street at night");
	});

	it("returns a studio-native aggregate snapshot", async () => {
		const repository = createMemoryRepository();
		await repository.createScenario({
			generatorScenarioId: null,
			id: "scenario-1",
			name: "Snapshot scenario",
			params: { steps: 8 },
			prompt: "Snapshot prompt",
			workflowKey: "fal-zimage-turbo",
		});
		await repository.createRun({
			errorSummary: null,
			generatorRunId: null,
			id: "run-1",
			inputImageUrl: "https://assets.example.com/input.png",
			inputPersonGenerationId: null,
			inputPersonId: null,
			loraPersonId: null,
			progressPct: null,
			providerEndpointId: "endpoint-1",
			providerJobId: "job-1",
			scenarioId: "scenario-1",
			status: "queued",
			workflowKey: "fal-zimage-turbo",
		});

		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository,
			s3Config: fakeS3Config,
		});

		const response = await app.request("http://localhost/api/studio-snapshot");

		expect(response.status).toBe(200);
		const snapshot = (await response.json()) as {
			runs: Array<{ scenarioName: string }>;
			scenarios: Array<{ name: string }>;
			workflows: Array<{ key: string }>;
		};
		expect(snapshot.scenarios[0]?.name).toBe("Snapshot scenario");
		expect(snapshot.runs[0]?.scenarioName).toBe("Snapshot scenario");
		expect(snapshot.workflows.some((w) => w.key === "fal-zimage-turbo")).toBe(
			true
		);
	});

	it("returns run debug bundle for GET /api/runs/:runId/debug", async () => {
		const repository = createMemoryRepository();
		await repository.createScenario({
			generatorScenarioId: null,
			id: "scenario-debug",
			name: "Debug scenario",
			params: {},
			prompt: "p",
			workflowKey: "fal-zimage-turbo",
		});
		await repository.createRun({
			errorSummary: null,
			generatorRunId: "execution-1",
			id: "run-debug",
			inputImageUrl: "https://assets.example.com/input.png",
			inputPersonGenerationId: null,
			inputPersonId: null,
			loraPersonId: null,
			progressPct: null,
			providerEndpointId: "endpoint-1",
			providerJobId: "job-1",
			scenarioId: "scenario-debug",
			status: "queued",
			workflowKey: "fal-zimage-turbo",
		});

		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository,
			s3Config: fakeS3Config,
		});

		const response = await app.request(
			"http://localhost/api/runs/run-debug/debug"
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as StudioRunDebugBundle;
		expect(body.run.id).toBe("run-debug");
		expect(body.execution?.id).toBe("execution-1");
		expect(body.executionError).toBeNull();
	});

	it("returns 404 for GET /api/runs/:runId/debug when run is missing", async () => {
		const repository = createMemoryRepository();
		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository,
			s3Config: fakeS3Config,
		});

		const response = await app.request(
			"http://localhost/api/runs/missing-run/debug"
		);

		expect(response.status).toBe(404);
	});

	it("marks an orphan run failed when generator launch throws", async () => {
		const repository = createMemoryRepository();
		await repository.createScenario({
			generatorScenarioId: null,
			id: "scenario-orphan",
			name: "Orphan scenario",
			params: {},
			prompt: "p",
			workflowKey: "fal-zimage-turbo",
		});

		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub({
				createExecution() {
					return Promise.reject(new Error("401 Unauthorized"));
				},
			}),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository,
			s3Config: fakeS3Config,
		});

		const runResponse = await app.request("http://localhost/api/runs", {
			body: JSON.stringify({ scenarioId: "scenario-orphan" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		expect(runResponse.status).toBe(500);

		const runs = await repository.listRuns();
		expect(runs).toHaveLength(1);
		expect(runs[0]?.status).toBe("failed");
		expect(runs[0]?.errorSummary).toBe("401 Unauthorized");
		expect(runs[0]?.completedAt).toBeInstanceOf(Date);
	});

	it("marks a run failed via internal endpoint", async () => {
		const repository = createMemoryRepository();
		await repository.createScenario({
			generatorScenarioId: null,
			id: "scenario-mark",
			name: "Mark scenario",
			params: {},
			prompt: "p",
			workflowKey: "fal-zimage-turbo",
		});
		await repository.createRun({
			errorSummary: null,
			generatorRunId: null,
			id: "run-stuck",
			inputImageUrl: "",
			inputPersonGenerationId: null,
			inputPersonId: null,
			loraPersonId: null,
			progressPct: null,
			providerEndpointId: null,
			providerJobId: null,
			scenarioId: "scenario-mark",
			status: "queued",
			workflowKey: "fal-zimage-turbo",
		});

		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve(null);
			},
			repository,
			s3Config: fakeS3Config,
		});

		const unauthorized = await app.request(
			"http://localhost/api/internal/runs/run-stuck/mark-failed",
			{
				body: JSON.stringify({ errorSummary: "manual cleanup" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}
		);
		expect(unauthorized.status).toBe(401);

		const ok = await app.request(
			"http://localhost/api/internal/runs/run-stuck/mark-failed",
			{
				body: JSON.stringify({ errorSummary: "manual cleanup" }),
				headers: {
					"content-type": "application/json",
					"x-generator-callback-token": "local-generator-callback-token",
				},
				method: "POST",
			}
		);
		expect(ok.status).toBe(200);
		const payload = (await ok.json()) as {
			run: { errorSummary: string; status: string };
		};
		expect(payload.run.status).toBe("failed");
		expect(payload.run.errorSummary).toBe("manual cleanup");

		const notFound = await app.request(
			"http://localhost/api/internal/runs/missing/mark-failed",
			{
				body: JSON.stringify({}),
				headers: {
					"content-type": "application/json",
					"x-generator-callback-token": "local-generator-callback-token",
				},
				method: "POST",
			}
		);
		expect(notFound.status).toBe(404);
	});

	it("streams initial snapshot via /api/runs/stream", async () => {
		const repository = createMemoryRepository();
		await repository.createScenario({
			generatorScenarioId: null,
			id: "scenario-stream",
			name: "Stream scenario",
			params: {},
			prompt: "p",
			workflowKey: "fal-zimage-turbo",
		});
		await repository.createRun({
			errorSummary: null,
			generatorRunId: null,
			id: "run-active",
			inputImageUrl: "https://input.example.com/in.png",
			inputPersonGenerationId: null,
			inputPersonId: null,
			loraPersonId: null,
			progressPct: 42,
			providerEndpointId: null,
			providerJobId: null,
			scenarioId: "scenario-stream",
			status: "running",
			workflowKey: "fal-zimage-turbo",
		});

		const { app } = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({ session: {}, user: {} });
			},
			repository,
			s3Config: fakeS3Config,
		});

		const response = await app.request("http://localhost/api/runs/stream");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error("expected SSE body");
		}
		const decoder = new TextDecoder();
		let buffer = "";
		let sawSnapshot = false;
		while (!sawSnapshot) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			if (buffer.includes("event: snapshot")) {
				sawSnapshot = true;
			}
		}
		await reader.cancel();
		expect(sawSnapshot).toBe(true);
		expect(buffer).toContain("run-active");
	});
});
