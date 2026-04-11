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
		async listPersons() {
			return [...persons.values()]
				.map((person) => hydratePerson(person.id))
				.filter((person): person is PersonRecord => person !== null)
				.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
		},
		async getPersonById(personId) {
			return hydratePerson(personId);
		},
		async getPersonBySlug(slug) {
			const person = [...persons.values()].find((entry) => entry.slug === slug);
			return person ? hydratePerson(person.id) : null;
		},
		async createPerson(input) {
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

			return hydratePerson(person.id)!;
		},
		async updatePerson(personId, input) {
			const current = persons.get(personId);
			if (!current) {
				return null;
			}

			const updated: PersonRecord = {
				...current,
				...input,
				updatedAt: new Date(),
				generations: current.generations,
			};
			persons.set(personId, updated);
			return hydratePerson(personId);
		},
		async deletePerson(personId) {
			for (const generation of generations.values()) {
				if (generation.personId === personId) {
					generations.delete(generation.id);
				}
			}

			return persons.delete(personId);
		},
		async findPersonByOperatorRunId(operatorRunId) {
			const generation = [...generations.values()].find(
				(entry) => entry.operatorRunId === operatorRunId
			);

			return generation ? hydratePerson(generation.personId) : null;
		},
		async createGeneration(input) {
			const generation: PersonGenerationRecord = {
				...input,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			generations.set(generation.id, generation);
			return generation;
		},
		async updateGeneration(generationId, input) {
			const current = generations.get(generationId);
			if (!current) {
				return null;
			}

			const updated: PersonGenerationRecord = {
				...current,
				...input,
				updatedAt: new Date(),
			};
			generations.set(generationId, updated);
			return updated;
		},
		async getGenerationByOperatorRunId(operatorRunId) {
			return (
				[...generations.values()].find(
					(generation) => generation.operatorRunId === operatorRunId
				) ?? null
			);
		},
		async listQueuedGenerations(limit) {
			return [...generations.values()]
				.filter((generation) => generation.status === "queued")
				.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
				.slice(0, limit);
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
			corsOrigin: "http://localhost:3004",
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
			corsOrigin: "http://localhost:3004",
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
			corsOrigin: "http://localhost:3004",
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
});
