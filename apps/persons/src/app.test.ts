import { describe, expect, it } from "bun:test";

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
		getRun(runId) {
			return Promise.resolve({
				id: runId,
				inputImageUrl: "https://assets.example.com/reference.png",
				scenarioId: "scenario-1",
				status: "succeeded",
				workflowKey: "fal-flux-dev",
				artifacts: [{ url: "https://cdn.example.com/output.png" }],
			});
		},
		getScenario(scenarioId) {
			return Promise.resolve({
				id: scenarioId,
				name: "Operator import",
				prompt: "Turn the reference image into a hero motion shot.",
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
		startPersonLoraTraining() {
			return Promise.resolve({
				accepted: true,
				jobId: "training-job-1",
			});
		},
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

	it("anchors lora generation prompts with the person identity description", async () => {
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
		const capturedExecutionInput = capturedExecutionInputs[0];
		if (!capturedExecutionInput) {
			throw new Error("Expected generator execution input to be captured");
		}
		expect(capturedExecutionInput.workflowKey).toBe("fal-zimage-turbo-lora");
		expect(capturedExecutionInput.prompt).toContain(
			"a photo of generated_subject"
		);
		expect(capturedExecutionInput.prompt).toContain("Red-haired woman");
		expect(capturedExecutionInput.prompt).toContain("jumping in a window");
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
});
