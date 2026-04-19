import { describe, expect, it } from "bun:test";
import type { LoraRegistryEntry } from "@generator/contracts/loras";
import type { LoraReadRepository } from "@generator/db/repositories/lora-read";
import { GENERATOR_CALLBACK_TOKEN_HEADER } from "@generator/http/shared";

import { createApp } from "@/app";
import type { AdminTrainingClient } from "@/clients/admin-training";
import type {
	OperatorServerClient,
	PersonGenerationRecord,
	PersonRecord,
	PersonsRepository,
} from "@/domain/persons";

function createMemoryRepository(): PersonsRepository {
	const persons = new Map<string, PersonRecord>();
	const generations = new Map<string, PersonGenerationRecord>();

	function hydratePerson(personId: string) {
		const person = persons.get(personId);
		if (!person) {
			return null;
		}

		const personGenerations = [...generations.values()]
			.filter((generation) => generation.personId === personId)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		return {
			...person,
			generations: personGenerations,
		};
	}

	return {
		listPersons() {
			return Promise.resolve(
				[...persons.values()]
					.map((person) => hydratePerson(person.id))
					.filter((person): person is PersonRecord => person !== null)
					.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
			);
		},
		getPersonById(personId) {
			return Promise.resolve(hydratePerson(personId));
		},
		getPersonBySlug(slug) {
			const person = [...persons.values()].find((entry) => entry.slug === slug);
			return Promise.resolve(person ? hydratePerson(person.id) : null);
		},
		createPerson(input) {
			const now = new Date();
			const person: PersonRecord = {
				...input.person,
				createdAt: now,
				updatedAt: now,
				generations: [],
			};
			persons.set(person.id, person);

			for (const generation of input.generations) {
				generations.set(generation.id, {
					...generation,
					personId: person.id,
					createdAt: now,
					updatedAt: now,
				});
			}

			const created = hydratePerson(person.id);
			if (!created) {
				throw new Error("Failed to hydrate created person");
			}
			return Promise.resolve(created);
		},
		updatePerson(personId, input) {
			const current = persons.get(personId);
			if (!current) {
				return Promise.resolve(null);
			}

			const updated: PersonRecord = {
				...current,
				...input,
				updatedAt: new Date(),
				generations: current.generations,
			};
			persons.set(personId, updated);
			return Promise.resolve(hydratePerson(personId));
		},
		deletePerson(personId) {
			for (const generation of generations.values()) {
				if (generation.personId === personId) {
					generations.delete(generation.id);
				}
			}

			return Promise.resolve(persons.delete(personId));
		},
		deleteGeneration(personId, generationId) {
			const generation = generations.get(generationId);
			if (!generation || generation.personId !== personId) {
				return Promise.resolve(null);
			}

			generations.delete(generationId);
			return Promise.resolve(generation);
		},
		deleteDatasetGenerations(personId, keepSourceUrls) {
			const keepSet = new Set(keepSourceUrls);
			let deletedCount = 0;
			for (const generation of generations.values()) {
				if (
					generation.personId === personId &&
					generation.metadata.isDatasetPhoto === true &&
					!keepSet.has(generation.sourceUrl)
				) {
					generations.delete(generation.id);
					deletedCount += 1;
				}
			}

			return Promise.resolve(deletedCount);
		},
		findPersonByOperatorRunId(operatorRunId) {
			const generation = [...generations.values()].find(
				(entry) => entry.operatorRunId === operatorRunId
			);

			return Promise.resolve(
				generation ? hydratePerson(generation.personId) : null
			);
		},
		createGeneration(input) {
			const generation: PersonGenerationRecord = {
				...input,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			generations.set(generation.id, generation);
			return Promise.resolve(generation);
		},
		updateGeneration(generationId, input) {
			const current = generations.get(generationId);
			if (!current) {
				return Promise.resolve(null);
			}

			const updated: PersonGenerationRecord = {
				...current,
				...input,
				updatedAt: new Date(),
			};
			generations.set(generationId, updated);
			return Promise.resolve(updated);
		},
		getGenerationByOperatorRunId(operatorRunId) {
			return Promise.resolve(
				[...generations.values()].find(
					(generation) => generation.operatorRunId === operatorRunId
				) ?? null
			);
		},
		listQueuedGenerations(limit) {
			return Promise.resolve(
				[...generations.values()]
					.filter((generation) => generation.status === "queued")
					.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
					.slice(0, limit)
			);
		},
	};
}

function createOperatorClient(): OperatorServerClient {
	return {
		cancelExecution() {
			return Promise.resolve({
				errorSummary: "Execution cancelled by operator",
				id: "execution-generated",
				inputImageUrl: "",
				providerEndpointId: null,
				providerJobId: null,
				status: "failed",
				workflowKey: "fal-zimage-turbo",
				artifacts: [],
			});
		},
		createExecution(input) {
			return Promise.resolve({
				errorSummary: null,
				id: "execution-generated",
				inputImageUrl: input.inputImageUrl ?? "",
				providerEndpointId: null,
				providerJobId: null,
				status: "queued",
				workflowKey: "fal-zimage-turbo",
				artifacts: [],
			});
		},
		getExecution() {
			return Promise.resolve({
				errorSummary: null,
				id: "execution-generated",
				inputImageUrl: "",
				providerEndpointId: "fal-ai/z-image",
				providerJobId: "run-generated",
				status: "succeeded",
				workflowKey: "fal-zimage-turbo",
				artifacts: [{ url: "https://cdn.example.com/generated-avatar.png" }],
			});
		},
		getHealth() {
			return Promise.resolve({
				ok: true,
				workflows: 1,
			});
		},
		syncExecution(input) {
			return Promise.resolve({
				errorSummary: null,
				id: input.providerJobId,
				inputImageUrl: "",
				providerEndpointId: input.providerEndpointId ?? "fal-ai/z-image",
				providerJobId: input.providerJobId,
				status: "succeeded",
				workflowKey: "fal-zimage-turbo",
				artifacts: [{ url: "https://cdn.example.com/generated-avatar.png" }],
			});
		},
	};
}

function createAdminTrainingClient(): AdminTrainingClient {
	return {
		cacheExternalLora(sourceUrl: string) {
			return Promise.resolve(sourceUrl);
		},
		confirmPersonLoraTraining() {
			return Promise.resolve({
				accepted: true,
				jobId: "training-job-confirm-1",
			});
		},
		requestVariantRefill() {
			return Promise.resolve();
		},
		startPersonLoraTraining() {
			return Promise.resolve({
				accepted: true,
				jobId: "training-job-1",
			});
		},
	};
}

function createMemoryLoraReadRepository(
	entries: LoraRegistryEntry[]
): LoraReadRepository {
	return {
		getById(id) {
			return Promise.resolve(entries.find((entry) => entry.id === id) ?? null);
		},
		getBySlug(slug) {
			return Promise.resolve(
				entries.find((entry) => entry.slug === slug) ?? null
			);
		},
		list(filter = {}) {
			return Promise.resolve(
				entries.filter((entry) => {
					if (filter.baseModel && entry.baseModel !== filter.baseModel) {
						return false;
					}
					if (filter.status && entry.status !== filter.status) {
						return false;
					}
					return true;
				})
			);
		},
	};
}

function createRegistryEntry(
	overrides: Partial<LoraRegistryEntry> = {}
): LoraRegistryEntry {
	const now = new Date().toISOString();
	return {
		id: "lora-1",
		slug: "demo",
		name: "Demo LoRA",
		description: "",
		baseModel: "z-image",
		sourceUrl: "https://example.com/demo.safetensors",
		s3Key: "loras/demo.safetensors",
		s3Url: "https://cdn.example.com/loras/demo.safetensors",
		sizeBytes: 1024,
		defaultWeight: 1,
		status: "active",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

describe("persons api", () => {
	it("creates persons with a mandatory reference photo and imports server runs", async () => {
		const app = createApp({
			corsOrigins: ["http://localhost:3004"],
			repository: createMemoryRepository(),
			operatorServerClient: createOperatorClient(),
		});

		const createResponse = await app.request("http://localhost/api/persons", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "Alex Storm",
				description:
					"Confident fashion character with a bright commercial look.",
				referencePhotoUrl: "https://assets.example.com/alex-reference.png",
				datasetUrl: "https://assets.example.com/alex-dataset.zip",
				loraUrl: "https://assets.example.com/alex.safetensors",
				voiceWavUrl: "https://assets.example.com/alex-voice.wav",
			}),
		});

		expect(createResponse.status).toBe(201);
		const { person } = (await createResponse.json()) as {
			person: PersonRecord;
		};
		expect(person.referencePhotoUrl).toContain("alex-reference.png");
		expect(person.slug).toBe("alex-storm");

		const importResponse = await app.request(
			`http://localhost/api/persons/${person.id}/generations/import`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerJobId: "run-42",
					workflowKey: "fal-flux-dev",
				}),
			}
		);

		expect(importResponse.status).toBe(201);
		const { generation } = (await importResponse.json()) as {
			generation: PersonGenerationRecord;
		};
		expect(generation.mediaType).toBe("image");
		expect(generation.operatorRunId).toBe("run-42");

		const listResponse = await app.request("http://localhost/api/persons");
		expect(listResponse.status).toBe(200);
		const payload = (await listResponse.json()) as { persons: PersonRecord[] };
		expect(payload.persons[0]?.generations).toHaveLength(1);
	});

	it("creates a person from a prompt by generating the reference avatar first", async () => {
		const app = createApp({
			corsOrigins: ["http://localhost:3004"],
			repository: createMemoryRepository(),
			operatorServerClient: createOperatorClient(),
		});

		const response = await app.request(
			"http://localhost/api/persons/from-prompt",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "Prompt Girl",
					description: "Generated from a text brief.",
					prompt:
						"Ultra-real portrait of a young woman with editorial lighting and a clean studio backdrop.",
				}),
			}
		);

		expect(response.status).toBe(201);
		const { person } = (await response.json()) as { person: PersonRecord };
		expect(person.referencePhotoUrl).toContain("data:image/svg+xml");
		expect(person.generations).toHaveLength(1);
		expect(person.generations[0]?.status).toBe("queued");
		const personResponse = await app.request(
			`http://localhost/api/persons/${person.id}`
		);
		expect(personResponse.status).toBe(200);
		const { person: hydratedPerson } = (await personResponse.json()) as {
			person: PersonRecord;
		};
		expect(hydratedPerson.referencePhotoUrl).toContain("data:image/svg+xml");
		expect(hydratedPerson.generations[0]?.status).toBe("queued");
		expect(hydratedPerson.metadata.autoStartTraining).toBe(true);
	});

	it("updates, clears asset fields, and deletes person records", async () => {
		const app = createApp({
			corsOrigins: ["http://localhost:3004"],
			repository: createMemoryRepository(),
			operatorServerClient: createOperatorClient(),
		});
		const createResponse = await app.request("http://localhost/api/persons", {
			body: JSON.stringify({
				datasetUrl: "https://assets.example.com/source.zip",
				loraUrl: "https://assets.example.com/source.safetensors",
				name: "Crud Girl",
				referencePhotoUrl: "https://assets.example.com/reference.png",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const { person } = (await createResponse.json()) as {
			person: PersonRecord;
		};

		const updateResponse = await app.request(
			`http://localhost/api/persons/${person.id}`,
			{
				body: JSON.stringify({
					datasetUrl: "",
					description: "Updated profile",
					loraUrl: null,
					name: "Crud Girl Updated",
					slug: "custom-crud-girl",
				}),
				headers: { "content-type": "application/json" },
				method: "PATCH",
			}
		);

		expect(updateResponse.status).toBe(200);
		const { person: updatedPerson } = (await updateResponse.json()) as {
			person: PersonRecord;
		};
		expect(updatedPerson.name).toBe("Crud Girl Updated");
		expect(updatedPerson.slug).toBe("custom-crud-girl");
		expect(updatedPerson.description).toBe("Updated profile");
		expect(updatedPerson.datasetUrl).toBeNull();
		expect(updatedPerson.loraUrl).toBeNull();

		const deleteResponse = await app.request(
			`http://localhost/api/persons/${person.id}`,
			{ method: "DELETE" }
		);
		expect(deleteResponse.status).toBe(204);

		const listResponse = await app.request("http://localhost/api/persons");
		const payload = (await listResponse.json()) as { persons: PersonRecord[] };
		expect(payload.persons).toHaveLength(0);
	});

	it("cancels queued prompt generations through the operator client", async () => {
		let cancelledExecutionId = "";
		const app = createApp({
			corsOrigins: ["http://localhost:3004"],
			repository: createMemoryRepository(),
			operatorServerClient: {
				...createOperatorClient(),
				cancelExecution(executionId) {
					cancelledExecutionId = executionId;
					return Promise.resolve({
						artifacts: [],
						errorSummary: "Execution cancelled by operator",
						id: executionId,
						inputImageUrl: "",
						providerEndpointId: null,
						providerJobId: null,
						status: "failed",
						workflowKey: "fal-zimage-turbo",
					});
				},
			},
		});

		const createResponse = await app.request("http://localhost/api/persons", {
			body: JSON.stringify({
				name: "Cancel Prompt",
				description: "Generate this person from prompt first.",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const { person } = (await createResponse.json()) as {
			person: PersonRecord;
		};
		const generation = person.generations[0];
		if (!generation) {
			throw new Error("Expected queued generation");
		}

		const cancelResponse = await app.request(
			`http://localhost/api/persons/${person.id}/generations/${generation.id}/cancel`,
			{ method: "POST" }
		);

		expect(cancelResponse.status).toBe(200);
		expect(cancelledExecutionId).toBe("execution-generated");
		const { person: cancelledPerson } = (await cancelResponse.json()) as {
			person: PersonRecord;
		};
		expect(cancelledPerson.generations[0]?.status).toBe("failed");
		expect(cancelledPerson.generations[0]?.errorSummary).toBe(
			"Generation cancelled by operator"
		);
		expect(typeof cancelledPerson.generations[0]?.metadata.cancelledAt).toBe(
			"string"
		);
	});

	it("queues lora training for an existing person", async () => {
		const app = createApp({
			adminTrainingClient: createAdminTrainingClient(),
			corsOrigins: ["http://localhost:3004"],
			repository: createMemoryRepository(),
			operatorServerClient: createOperatorClient(),
		});
		const createResponse = await app.request("http://localhost/api/persons", {
			body: JSON.stringify({
				name: "Train Me",
				referencePhotoUrl: "https://assets.example.com/train-me.png",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const { person } = (await createResponse.json()) as {
			person: PersonRecord;
		};

		const response = await app.request(
			`http://localhost/api/persons/${person.id}/train-lora`,
			{
				body: JSON.stringify({}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}
		);

		expect(response.status).toBe(202);
		const payload = (await response.json()) as { person: PersonRecord };
		expect(payload.person.metadata.training).toMatchObject({
			status: "queued",
		});
	});

	it("cancels active lora training and ignores later callbacks for that run", async () => {
		const app = createApp({
			adminTrainingClient: createAdminTrainingClient(),
			corsOrigins: ["http://localhost:3004"],
			repository: createMemoryRepository(),
			operatorServerClient: createOperatorClient(),
		});
		const createResponse = await app.request("http://localhost/api/persons", {
			body: JSON.stringify({
				name: "Cancel Training",
				referencePhotoUrl: "https://assets.example.com/reference.png",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const { person } = (await createResponse.json()) as {
			person: PersonRecord;
		};
		const trainResponse = await app.request(
			`http://localhost/api/persons/${person.id}/train-lora`,
			{
				body: JSON.stringify({}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}
		);
		const { person: trainingPerson } = (await trainResponse.json()) as {
			person: PersonRecord;
		};
		const training = trainingPerson.metadata.training as {
			trainingRunId?: string;
		};

		const cancelResponse = await app.request(
			`http://localhost/api/persons/${person.id}/train-lora/cancel`,
			{ method: "POST" }
		);

		expect(cancelResponse.status).toBe(200);
		const { person: cancelledPerson } = (await cancelResponse.json()) as {
			person: PersonRecord;
		};
		expect(cancelledPerson.metadata.training).toMatchObject({
			errorSummary: "LoRA pipeline cancelled by operator",
			phase: "cancelled",
			status: "failed",
		});

		await app.request("http://localhost/api/internal/lora-trainings", {
			body: JSON.stringify({
				context: { personId: person.id },
				event: {
					loraUrl: "https://assets.example.com/late.safetensors",
					status: "ready",
					trainingRunId: training.trainingRunId,
				},
			}),
			headers: {
				authorization: "Bearer local-training-control-token",
				"content-type": "application/json",
			},
			method: "POST",
		});

		const personResponse = await app.request(
			`http://localhost/api/persons/${person.id}`
		);
		const { person: hydratedPerson } = (await personResponse.json()) as {
			person: PersonRecord;
		};
		expect(hydratedPerson.loraUrl).toBeNull();
		expect(hydratedPerson.metadata.training).toMatchObject({
			phase: "cancelled",
			status: "failed",
		});
	});

	it("generates with lora through reference-conditioned zimage i2i", async () => {
		const capturedExecutionInputs: Parameters<
			OperatorServerClient["createExecution"]
		>[0][] = [];
		const app = createApp({
			corsOrigins: ["http://localhost:3004"],
			repository: createMemoryRepository(),
			operatorServerClient: {
				...createOperatorClient(),
				createExecution(input) {
					capturedExecutionInputs.push(input);
					return Promise.resolve({
						artifacts: [],
						errorSummary: null,
						id: "execution-lora",
						inputImageUrl: input.inputImageUrl ?? "",
						providerEndpointId: null,
						providerJobId: "provider-lora",
						status: "queued",
						workflowKey: input.workflowKey,
					});
				},
			},
		});
		const createResponse = await app.request("http://localhost/api/persons", {
			body: JSON.stringify({
				description:
					"Red-haired woman with green eyes, light freckles, realistic skin.",
				loraUrl: "https://assets.example.com/person.safetensors",
				name: "Generated Subject",
				referencePhotoUrl: "https://assets.example.com/reference.png",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const { person } = (await createResponse.json()) as {
			person: PersonRecord;
		};

		const response = await app.request(
			`http://localhost/api/persons/${person.id}/generate-with-lora`,
			{
				body: JSON.stringify({ prompt: "jumping in a window" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}
		);

		expect(response.status).toBe(202);
		const { person: queuedPerson } = (await response.json()) as {
			person: PersonRecord;
		};
		const queuedGeneration = queuedPerson.generations[0];
		if (!queuedGeneration) {
			throw new Error("Expected queued generation");
		}
		expect(queuedGeneration.metadata.progressPct).toBe(5);
		const capturedExecutionInput = capturedExecutionInputs[0];
		if (!capturedExecutionInput) {
			throw new Error("Expected generator execution input to be captured");
		}
		const executionInput = capturedExecutionInput as {
			inputImageUrl?: string;
			params: Record<string, unknown>;
			prompt: string;
			workflowKey: string;
		};
		expect(executionInput).toMatchObject({
			inputImageUrl: "https://assets.example.com/reference.png",
			workflowKey: "fal-zimage-turbo-image-to-image",
			params: {
				imageSize: "portrait_4_3",
				loraUrl: "https://assets.example.com/person.safetensors",
				loraWeight: 1,
				numInferenceSteps: 8,
				strength: 0.95,
			},
		});
		expect(executionInput.prompt).toContain(
			"a photo of ohwx_generated_subject"
		);
		expect(executionInput.prompt).toContain("jumping in a window");
		expect(executionInput.prompt).toContain(
			"portrait of ohwx_generated_subject"
		);

		const callbackResponse = await app.request(
			"http://localhost/api/internal/generator-executions",
			{
				body: JSON.stringify({
					context: {
						generationId: queuedGeneration.id,
						personId: person.id,
					},
					execution: {
						artifacts: [],
						errorSummary: null,
						id: "execution-lora",
						inputImageUrl: "https://assets.example.com/reference.png",
						progressPct: 42,
						providerEndpointId: "fal-ai/z-image",
						providerJobId: "provider-lora",
						status: "running",
						workflowKey: "fal-zimage-turbo-image-to-image",
					},
				}),
				headers: {
					"content-type": "application/json",
					[GENERATOR_CALLBACK_TOKEN_HEADER]: "local-generator-callback-token",
				},
				method: "POST",
			}
		);
		expect(callbackResponse.status).toBe(200);
		const { person: runningPerson } = (await callbackResponse.json()) as {
			person: PersonRecord;
		};
		expect(runningPerson.generations[0]?.metadata.progressPct).toBe(42);
		expect(runningPerson.generations[0]?.metadata.generatorStatus).toBe(
			"running"
		);
	});

	it("replaces dataset photos on subsequent training callbacks", async () => {
		const app = createApp({
			corsOrigins: ["http://localhost:3004"],
			repository: createMemoryRepository(),
		});
		const createResponse = await app.request("http://localhost/api/persons", {
			body: JSON.stringify({
				name: "Dataset Replace",
				referencePhotoUrl: "https://assets.example.com/reference.png",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const { person } = (await createResponse.json()) as {
			person: PersonRecord;
		};

		await app.request("http://localhost/api/internal/lora-trainings", {
			body: JSON.stringify({
				context: { personId: person.id },
				event: {
					referenceImageUrls: [
						"https://assets.example.com/reference.png",
						"https://assets.example.com/dataset-1.png",
						"https://assets.example.com/dataset-2.png",
					],
					status: "generating",
				},
			}),
			headers: {
				authorization: "Bearer local-training-control-token",
				"content-type": "application/json",
			},
			method: "POST",
		});

		await app.request("http://localhost/api/internal/lora-trainings", {
			body: JSON.stringify({
				context: { personId: person.id },
				event: {
					referenceImageUrls: [
						"https://assets.example.com/reference.png",
						"https://assets.example.com/dataset-3.png",
					],
					status: "training",
				},
			}),
			headers: {
				authorization: "Bearer local-training-control-token",
				"content-type": "application/json",
			},
			method: "POST",
		});

		const personResponse = await app.request(
			`http://localhost/api/persons/${person.id}`
		);
		const { person: hydratedPerson } = (await personResponse.json()) as {
			person: PersonRecord;
		};
		const datasetUrls = hydratedPerson.generations
			.filter((generation) => generation.metadata.isDatasetPhoto === true)
			.map((generation) => generation.sourceUrl)
			.sort();

		expect(datasetUrls).toEqual([
			"https://assets.example.com/dataset-3.png",
			"https://assets.example.com/reference.png",
		]);
	});

	it("preserves referenceImageCount across polling callbacks that omit it", async () => {
		const app = createApp({
			corsOrigins: ["http://localhost:3004"],
			repository: createMemoryRepository(),
		});
		const createResponse = await app.request("http://localhost/api/persons", {
			body: JSON.stringify({
				name: "Refs Counter",
				referencePhotoUrl: "https://assets.example.com/reference.png",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const { person } = (await createResponse.json()) as {
			person: PersonRecord;
		};

		// Initial event from the dataset upload step: 17 unique URLs but the
		// zip actually packs 20 images (the original photo is duplicated 4×).
		await app.request("http://localhost/api/internal/lora-trainings", {
			body: JSON.stringify({
				context: { personId: person.id },
				event: {
					phase: "starting-training",
					referenceImageCount: 20,
					referenceImageTargetCount: 20,
					referenceImageUrls: [
						"https://assets.example.com/reference.png",
						...Array.from(
							{ length: 16 },
							(_, index) => `https://assets.example.com/dataset-${index}.png`
						),
					],
					status: "training",
				},
			}),
			headers: {
				authorization: "Bearer local-training-control-token",
				"content-type": "application/json",
			},
			method: "POST",
		});

		// A subsequent polling callback that does NOT carry referenceImageCount
		// must not downgrade the previously-recorded value to the URL count
		// (17). Otherwise the UI would render a stuck-looking "refs 17/20".
		await app.request("http://localhost/api/internal/lora-trainings", {
			body: JSON.stringify({
				context: { personId: person.id },
				event: {
					phase: "polling-training",
					providerStatus: "IN_PROGRESS",
					status: "training",
				},
			}),
			headers: {
				authorization: "Bearer local-training-control-token",
				"content-type": "application/json",
			},
			method: "POST",
		});

		const personResponse = await app.request(
			`http://localhost/api/persons/${person.id}`
		);
		const { person: hydratedPerson } = (await personResponse.json()) as {
			person: PersonRecord;
		};
		const training = (hydratedPerson.metadata as { training?: unknown })
			.training as { referenceImageCount?: number } | undefined;
		expect(training?.referenceImageCount).toBe(20);
	});

	it("exposes internal persons snapshot to bearer-authorized callers", async () => {
		const repository = createMemoryRepository();
		await repository.createPerson({
			generations: [],
			person: {
				datasetUrl: null,
				description: "",
				id: "person-internal-snapshot",
				loraUrl: null,
				metadata: {},
				name: "Internal Snapshot",
				photoUrl: null,
				referencePhotoUrl: "https://assets.example.com/reference.png",
				slug: "internal-snapshot",
				videoUrl: null,
				voiceWavUrl: null,
			},
		});

		const app = createApp({
			corsOrigins: ["http://localhost:3004"],
			getSession() {
				return Promise.resolve(null);
			},
			repository,
		});
		const protectedResponse = await app.request("http://localhost/api/persons");
		expect(protectedResponse.status).toBe(401);

		const unauthorizedResponse = await app.request(
			"http://localhost/api/internal/persons"
		);
		expect(unauthorizedResponse.status).toBe(401);

		const response = await app.request(
			"http://localhost/api/internal/persons",
			{
				headers: {
					authorization: "Bearer local-training-control-token",
				},
			}
		);
		expect(response.status).toBe(200);
		const { persons } = (await response.json()) as { persons: PersonRecord[] };
		expect(persons.map((person) => person.name)).toEqual(["Internal Snapshot"]);
	});

	it("deletes generations and removes deleted dataset photos from training metadata", async () => {
		const app = createApp({
			corsOrigins: ["http://localhost:3004"],
			repository: createMemoryRepository(),
			operatorServerClient: createOperatorClient(),
		});
		const createResponse = await app.request("http://localhost/api/persons", {
			body: JSON.stringify({
				name: "Delete Media",
				referencePhotoUrl: "https://assets.example.com/reference.png",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const { person } = (await createResponse.json()) as {
			person: PersonRecord;
		};

		const importResponse = await app.request(
			`http://localhost/api/persons/${person.id}/generations/import`,
			{
				body: JSON.stringify({
					providerJobId: "run-delete-1",
					workflowKey: "fal-flux-dev",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}
		);
		const { generation } = (await importResponse.json()) as {
			generation: PersonGenerationRecord;
		};

		const deleteGenerationResponse = await app.request(
			`http://localhost/api/persons/${person.id}/generations/${generation.id}`,
			{ method: "DELETE" }
		);
		expect(deleteGenerationResponse.status).toBe(200);
		const { person: afterGenerationDelete } =
			(await deleteGenerationResponse.json()) as {
				person: PersonRecord;
			};
		expect(afterGenerationDelete.generations).toHaveLength(0);

		await app.request("http://localhost/api/internal/lora-trainings", {
			body: JSON.stringify({
				context: { personId: person.id },
				event: {
					referenceImageUrls: [
						"https://assets.example.com/reference.png",
						"https://assets.example.com/dataset-delete.png",
					],
					status: "generating",
				},
			}),
			headers: {
				authorization: "Bearer local-training-control-token",
				"content-type": "application/json",
			},
			method: "POST",
		});

		const personWithDatasetResponse = await app.request(
			`http://localhost/api/persons/${person.id}`
		);
		const { person: personWithDataset } =
			(await personWithDatasetResponse.json()) as {
				person: PersonRecord;
			};
		const datasetGeneration = personWithDataset.generations.find(
			(item) =>
				item.sourceUrl === "https://assets.example.com/dataset-delete.png"
		);
		if (!datasetGeneration) {
			throw new Error("Expected dataset generation");
		}

		const deleteDatasetResponse = await app.request(
			`http://localhost/api/persons/${person.id}/generations/${datasetGeneration.id}`,
			{ method: "DELETE" }
		);
		expect(deleteDatasetResponse.status).toBe(200);
		const { person: afterDatasetDelete } =
			(await deleteDatasetResponse.json()) as {
				person: PersonRecord;
			};
		expect(
			afterDatasetDelete.generations.some(
				(item) => item.sourceUrl === datasetGeneration.sourceUrl
			)
		).toBe(false);
		const training = afterDatasetDelete.metadata.training as {
			referenceImageUrls?: string[];
		};
		expect(training.referenceImageUrls).not.toContain(
			datasetGeneration.sourceUrl
		);
	});

	it("exposes /api/loras backed by the admin registry client", async () => {
		const entries: LoraRegistryEntry[] = [
			createRegistryEntry({
				id: "lora-z",
				slug: "z-one",
				name: "Z One",
				baseModel: "z-image",
			}),
			createRegistryEntry({
				id: "lora-f",
				slug: "flux-one",
				name: "Flux One",
				baseModel: "flux",
			}),
			createRegistryEntry({
				id: "lora-archived",
				slug: "archived",
				name: "Archived",
				baseModel: "z-image",
				status: "archived",
			}),
		];

		const app = createApp({
			corsOrigins: ["http://localhost:3004"],
			loraReadRepository: createMemoryLoraReadRepository(entries),
			repository: createMemoryRepository(),
		});

		const allResponse = await app.request("http://localhost/api/loras");
		expect(allResponse.status).toBe(200);
		const { loras } = (await allResponse.json()) as {
			loras: LoraRegistryEntry[];
		};
		expect(loras.map((entry) => entry.id)).toEqual(["lora-z", "lora-f"]);

		const zResponse = await app.request(
			"http://localhost/api/loras?baseModel=z-image"
		);
		expect(zResponse.status).toBe(200);
		const { loras: zLoras } = (await zResponse.json()) as {
			loras: LoraRegistryEntry[];
		};
		expect(zLoras).toHaveLength(1);
		expect(zLoras[0]?.id).toBe("lora-z");
	});

	it("returns 500 when LoRA read repository fails", async () => {
		const app = createApp({
			corsOrigins: ["http://localhost:3004"],
			loraReadRepository: {
				getById() {
					return Promise.resolve(null);
				},
				getByPairGroupId() {
					return Promise.resolve([]);
				},
				getByS3Urls() {
					return Promise.resolve([]);
				},
				getBySlug() {
					return Promise.resolve(null);
				},
				list() {
					return Promise.reject(new Error("db boom"));
				},
			},
			repository: createMemoryRepository(),
		});

		const response = await app.request("http://localhost/api/loras");
		expect(response.status).toBe(500);
		const payload = (await response.json()) as { error: string };
		expect(payload.error).toBe("db boom");
	});
});
