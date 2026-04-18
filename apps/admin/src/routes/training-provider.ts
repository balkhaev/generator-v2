import type {
	TrainingProviderAvailability,
	TrainingProviderSettingsSnapshot,
} from "@generator/contracts/admin";
import { Hono } from "hono";

import {
	TRAINING_PROVIDER_NAMES,
	type TrainingProviderName,
	type TrainingProviderSettings,
} from "@/domain/training-provider-settings";
import {
	isWorkerSnapshotFresh,
	type WorkerSettingsReader,
} from "@/domain/worker-settings-store";

export interface TrainingProviderAvailabilityResolver {
	resolve(): TrainingProviderSettingsSnapshot["availability"];
}

function isTrainingProvider(value: unknown): value is TrainingProviderName {
	return (
		typeof value === "string" &&
		TRAINING_PROVIDER_NAMES.includes(value as TrainingProviderName)
	);
}

async function resolveAvailability(deps: {
	availability: TrainingProviderAvailabilityResolver;
	workerSettingsReader?: WorkerSettingsReader;
}): Promise<TrainingProviderAvailability[]> {
	if (deps.workerSettingsReader) {
		const snapshot = await deps.workerSettingsReader.read();
		if (snapshot && isWorkerSnapshotFresh(snapshot)) {
			return snapshot.availability;
		}
	}
	return deps.availability.resolve();
}

export function createTrainingProviderRoutes(deps: {
	availability: TrainingProviderAvailabilityResolver;
	settings: TrainingProviderSettings;
	workerSettingsReader?: WorkerSettingsReader;
}) {
	const app = new Hono();

	app.get("/", async (c) => {
		const [provider, availability] = await Promise.all([
			deps.settings.getProvider(),
			resolveAvailability(deps),
		]);
		const snapshot: TrainingProviderSettingsSnapshot = {
			availability,
			provider,
		};
		return c.json(snapshot);
	});

	app.put("/", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const provider =
			body && typeof body === "object"
				? (body as Record<string, unknown>).provider
				: undefined;

		if (!isTrainingProvider(provider)) {
			return c.json(
				{
					error: `provider must be one of: ${TRAINING_PROVIDER_NAMES.join(", ")}`,
				},
				400
			);
		}

		const availability = await resolveAvailability(deps);
		const target = availability.find((entry) => entry.provider === provider);
		if (target && !target.configured) {
			return c.json(
				{
					error: `Provider "${provider}" is not configured. Missing env: ${target.missing.join(", ")}`,
				},
				400
			);
		}

		await deps.settings.setProvider(provider);
		const snapshot: TrainingProviderSettingsSnapshot = {
			availability,
			provider,
		};
		return c.json(snapshot);
	});

	return app;
}
