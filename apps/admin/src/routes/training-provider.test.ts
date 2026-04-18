import { describe, expect, test } from "bun:test";

import {
	createInMemoryTrainingProviderSettings,
	type TrainingProviderName,
} from "@/domain/training-provider-settings";
import { createTrainingProviderRoutes } from "@/routes/training-provider";

function makeApp(opts: {
	available: TrainingProviderName[];
	initial: TrainingProviderName;
}) {
	const settings = createInMemoryTrainingProviderSettings(opts.initial);
	const app = createTrainingProviderRoutes({
		availability: {
			resolve: () => [
				{
					configured: opts.available.includes("fal"),
					missing: opts.available.includes("fal") ? [] : ["FAL_KEY"],
					provider: "fal",
				},
				{
					configured: opts.available.includes("runpod"),
					missing: opts.available.includes("runpod")
						? []
						: ["RUNPOD_API_KEY", "RUNPOD_AI_TOOLKIT_ENDPOINT_ID"],
					provider: "runpod",
				},
			],
		},
		settings,
	});
	return { app, settings };
}

describe("training-provider routes", () => {
	test("GET / returns current provider and availability", async () => {
		const { app } = makeApp({ available: ["fal"], initial: "fal" });
		const response = await app.request("/");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			availability: { configured: boolean; provider: string }[];
			provider: string;
		};
		expect(body.provider).toBe("fal");
		expect(body.availability).toHaveLength(2);
		const runpod = body.availability.find((a) => a.provider === "runpod");
		expect(runpod?.configured).toBe(false);
	});

	test("PUT / persists a configured provider", async () => {
		const { app, settings } = makeApp({
			available: ["fal", "runpod"],
			initial: "fal",
		});
		const response = await app.request("/", {
			body: JSON.stringify({ provider: "runpod" }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		});
		expect(response.status).toBe(200);
		expect(await settings.getProvider()).toBe("runpod");
	});

	test("PUT / rejects an unconfigured provider with 400", async () => {
		const { app, settings } = makeApp({ available: ["fal"], initial: "fal" });
		const response = await app.request("/", {
			body: JSON.stringify({ provider: "runpod" }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		});
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toContain("RUNPOD_API_KEY");
		expect(await settings.getProvider()).toBe("fal");
	});

	test("PUT / rejects an unknown provider value", async () => {
		const { app } = makeApp({ available: ["fal"], initial: "fal" });
		const response = await app.request("/", {
			body: JSON.stringify({ provider: "stable-horde" }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		});
		expect(response.status).toBe(400);
	});
});
