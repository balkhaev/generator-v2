import type { TrainingProviderSettingsSnapshot } from "@generator/contracts/admin";
import { Hono } from "hono";

import {
	TRAINING_PROVIDER_NAMES,
	type TrainingProviderName,
	type TrainingProviderSettings,
} from "@/domain/training-provider-settings";

export interface TrainingProviderAvailabilityResolver {
	resolve(): TrainingProviderSettingsSnapshot["availability"];
}

function isTrainingProvider(value: unknown): value is TrainingProviderName {
	return (
		typeof value === "string" &&
		TRAINING_PROVIDER_NAMES.includes(value as TrainingProviderName)
	);
}

export function createTrainingProviderRoutes(deps: {
	availability: TrainingProviderAvailabilityResolver;
	settings: TrainingProviderSettings;
}) {
	const app = new Hono();

	app.get("/", async (c) => {
		const provider = await deps.settings.getProvider();
		const availability = deps.availability.resolve();
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

		const availability = deps.availability.resolve();
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
