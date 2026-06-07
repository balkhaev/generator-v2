import { describe, expect, it } from "bun:test";
import type { PersonRecord } from "@generator/contracts/persons";
import {
	createIdempotencyLock,
	type IdempotencyLockStore,
} from "@generator/queue";

import type { PersonsApiClient } from "@/clients/persons-api";
import { recoverInterruptedTrainings } from "@/recovery/training-recovery";

const FIXED_NOW = Date.parse("2026-04-17T18:00:00.000Z");
const STALE_LAST_EVENT = "2026-04-17T17:50:00.000Z";
const FRESH_LAST_EVENT = "2026-04-17T17:59:30.000Z";

function createInMemoryStore(): IdempotencyLockStore {
	const map = new Map<string, string>();
	return {
		close() {
			map.clear();
			return Promise.resolve();
		},
		deleteIfOwned(key, value) {
			if (map.get(key) === value) {
				map.delete(key);
			}
			return Promise.resolve();
		},
		setNx(key, value) {
			if (map.has(key)) {
				return Promise.resolve(false);
			}
			map.set(key, value);
			return Promise.resolve(true);
		},
	};
}

function createSilentLogger() {
	return {
		error: () => undefined,
		info: () => undefined,
		warn: () => undefined,
	};
}

interface TrainingMetaOverrides {
	lastEventAt?: string;
	outputName?: string | null;
	phase?: string | null;
	provider?: string | null;
	providerJobId?: string | null;
	status?: string | null;
	trainingRunId?: string | null;
	trainingStartedAt?: string | null;
	trainingSteps?: number | null;
	triggerWord?: string | null;
}

function buildPerson(
	id: string,
	overrides: TrainingMetaOverrides = {}
): PersonRecord {
	return {
		createdAt: "2026-04-10T00:00:00.000Z",
		datasetUrl: null,
		description: "",
		generations: [],
		id,
		loraUrl: null,
		metadata: {
			training: {
				lastEventAt: overrides.lastEventAt ?? STALE_LAST_EVENT,
				outputName:
					overrides.outputName === undefined
						? `${id}-output`
						: overrides.outputName,
				phase: overrides.phase ?? "polling-training",
				provider:
					overrides.provider === undefined ? "runpod-pod" : overrides.provider,
				providerJobId:
					overrides.providerJobId === undefined
						? `pod-job-${id}`
						: overrides.providerJobId,
				referenceImageCount: 20,
				referenceImageTargetCount: 25,
				referenceImageUrls: [`https://cdn.example.com/${id}/00.png`],
				status: overrides.status === undefined ? "training" : overrides.status,
				trainingRunId:
					overrides.trainingRunId === undefined
						? `run-${id}`
						: overrides.trainingRunId,
				trainingStartedAt:
					overrides.trainingStartedAt === undefined
						? "2026-04-17T17:30:00.000Z"
						: overrides.trainingStartedAt,
				trainingSteps:
					overrides.trainingSteps === undefined
						? 1500
						: overrides.trainingSteps,
				triggerWord:
					overrides.triggerWord === undefined
						? `ohwx_${id}`
						: overrides.triggerWord,
			},
		},
		name: `Person ${id}`,
		photoUrl: null,
		referencePhotoUrl: `https://cdn.example.com/${id}/source.png`,
		slug: id,
		updatedAt: "2026-04-17T17:30:00.000Z",
		videoUrl: null,
		voiceWavUrl: null,
	};
}

function buildClient(persons: PersonRecord[]): PersonsApiClient {
	return {
		listPersons: () => Promise.resolve(persons),
	};
}

function passthroughRunpodRunner(
	resumeFromProviderJob: (input: {
		outputName: string;
		personSlug: string;
		providerJobId: string;
		trainingRunId: string;
	}) => Promise<void>
) {
	return {
		prepareDataset: () =>
			Promise.reject(
				new Error("prepareDataset must not be called for resumable runs")
			),
		resumeFromProviderJob,
	};
}

describe("recoverInterruptedTrainings", () => {
	it("resumes a stale runpod-pod training run", async () => {
		const lock = createIdempotencyLock({
			keyPrefix: "test",
			store: createInMemoryStore(),
			ttlSeconds: 60,
		});
		const calls: Array<{ providerJobId: string; trainingRunId: string }> = [];

		const summary = await recoverInterruptedTrainings({
			client: buildClient([buildPerson("alpha")]),
			logger: createSilentLogger(),
			now: () => FIXED_NOW,
			recoveryLock: lock,
			runpodPodRunner: passthroughRunpodRunner((input) => {
				calls.push({
					providerJobId: input.providerJobId,
					trainingRunId: input.trainingRunId,
				});
				return Promise.resolve();
			}),
		});

		expect(summary).toEqual({
			attempted: 1,
			failed: 0,
			recovered: 1,
			skipped: 0,
		});
		expect(calls).toEqual([
			{ providerJobId: "pod-job-alpha", trainingRunId: "run-alpha" },
		]);
	});

	it("skips runs whose last event is fresher than the staleness window", async () => {
		const lock = createIdempotencyLock({
			keyPrefix: "test",
			store: createInMemoryStore(),
			ttlSeconds: 60,
		});
		let resumeCalled = false;

		const summary = await recoverInterruptedTrainings({
			client: buildClient([
				buildPerson("alpha", { lastEventAt: FRESH_LAST_EVENT }),
			]),
			logger: createSilentLogger(),
			now: () => FIXED_NOW,
			recoveryLock: lock,
			runpodPodRunner: passthroughRunpodRunner(() => {
				resumeCalled = true;
				return Promise.resolve();
			}),
		});

		expect(summary.attempted).toBe(0);
		expect(resumeCalled).toBe(false);
	});

	it("ignores unknown providers, missing job ids, and cancelled runs", async () => {
		const lock = createIdempotencyLock({
			keyPrefix: "test",
			store: createInMemoryStore(),
			ttlSeconds: 60,
		});
		let resumeCalled = false;

		const summary = await recoverInterruptedTrainings({
			client: buildClient([
				buildPerson("non-supported", { provider: "replicate" }),
				buildPerson("legacy-fal", { provider: "fal" }),
				buildPerson("no-job", { providerJobId: null }),
				buildPerson("cancelled", { phase: "cancelled" }),
				buildPerson("queued", { status: "queued" }),
			]),
			logger: createSilentLogger(),
			now: () => FIXED_NOW,
			recoveryLock: lock,
			runpodPodRunner: passthroughRunpodRunner(() => {
				resumeCalled = true;
				return Promise.resolve();
			}),
		});

		expect(summary.attempted).toBe(0);
		expect(resumeCalled).toBe(false);
	});

	it("reports failures without aborting the sweep", async () => {
		const lock = createIdempotencyLock({
			keyPrefix: "test",
			store: createInMemoryStore(),
			ttlSeconds: 60,
		});
		const calls: string[] = [];

		const summary = await recoverInterruptedTrainings({
			client: buildClient([buildPerson("alpha"), buildPerson("beta")]),
			logger: createSilentLogger(),
			now: () => FIXED_NOW,
			recoveryLock: lock,
			runpodPodRunner: passthroughRunpodRunner((input) => {
				calls.push(input.trainingRunId);
				if (input.trainingRunId === "run-alpha") {
					return Promise.reject(new Error("runpod status fetch failed"));
				}
				return Promise.resolve();
			}),
		});

		expect(calls).toEqual(["run-alpha", "run-beta"]);
		expect(summary).toEqual({
			attempted: 2,
			failed: 1,
			recovered: 1,
			skipped: 0,
		});
	});

	it("resumes a stale runpod-pod run via the dedicated runner", async () => {
		const lock = createIdempotencyLock({
			keyPrefix: "test",
			store: createInMemoryStore(),
			ttlSeconds: 60,
		});
		const calls: Array<{
			outputName: string;
			personSlug: string;
			providerJobId: string;
			trainingRunId: string;
		}> = [];

		const summary = await recoverInterruptedTrainings({
			client: buildClient([
				buildPerson("zeta", {
					provider: "runpod-pod",
					providerJobId: "pod-zeta",
				}),
			]),
			logger: createSilentLogger(),
			now: () => FIXED_NOW,
			recoveryLock: lock,
			runpodPodRunner: passthroughRunpodRunner((input) => {
				calls.push({
					outputName: input.outputName,
					personSlug: input.personSlug,
					providerJobId: input.providerJobId,
					trainingRunId: input.trainingRunId,
				});
				return Promise.resolve();
			}),
		});

		expect(summary).toEqual({
			attempted: 1,
			failed: 0,
			recovered: 1,
			skipped: 0,
		});
		expect(calls).toEqual([
			{
				outputName: "zeta-output",
				personSlug: "zeta",
				providerJobId: "pod-zeta",
				trainingRunId: "run-zeta",
			},
		]);
	});

	it("skips runpod-pod runs when the dedicated runner is missing", async () => {
		const lock = createIdempotencyLock({
			keyPrefix: "test",
			store: createInMemoryStore(),
			ttlSeconds: 60,
		});

		const summary = await recoverInterruptedTrainings({
			client: buildClient([
				buildPerson("zeta", {
					provider: "runpod-pod",
					providerJobId: "pod-zeta",
				}),
			]),
			logger: createSilentLogger(),
			now: () => FIXED_NOW,
			recoveryLock: lock,
		});

		expect(summary).toEqual({
			attempted: 0,
			failed: 0,
			recovered: 0,
			skipped: 1,
		});
	});

	it("skips a run that another replica is already recovering", async () => {
		const store = createInMemoryStore();
		const lockA = createIdempotencyLock({
			keyPrefix: "test",
			ownerToken: "replica-a",
			store,
			ttlSeconds: 60,
		});
		const lockB = createIdempotencyLock({
			keyPrefix: "test",
			ownerToken: "replica-b",
			store,
			ttlSeconds: 60,
		});

		const firstSummary = await recoverInterruptedTrainings({
			client: buildClient([buildPerson("alpha")]),
			logger: createSilentLogger(),
			now: () => FIXED_NOW,
			recoveryLock: lockA,
			runpodPodRunner: passthroughRunpodRunner(() => Promise.resolve()),
		});
		expect(firstSummary.recovered).toBe(1);

		let secondInvoked = false;
		const secondSummary = await recoverInterruptedTrainings({
			client: buildClient([buildPerson("alpha")]),
			logger: createSilentLogger(),
			now: () => FIXED_NOW,
			recoveryLock: lockB,
			runpodPodRunner: passthroughRunpodRunner(() => {
				secondInvoked = true;
				return Promise.resolve();
			}),
		});

		expect(secondInvoked).toBe(false);
		expect(secondSummary).toEqual({
			attempted: 1,
			failed: 0,
			recovered: 0,
			skipped: 1,
		});
	});
});
