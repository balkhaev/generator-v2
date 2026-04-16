import { describe, expect, it } from "bun:test";

import { createApp } from "@/app";

function createEmptyDashboardSnapshot() {
	return {
		loraTrainings: [],
		notices: [],
		recentRuns: [],
		runStatus: {
			failed: 0,
			queued: 0,
			running: 0,
			succeeded: 0,
		},
		scenarios: [],
		snapshotAt: new Date().toISOString(),
	};
}

describe("admin gateway", () => {
	it("rejects protected routes when the session is missing", async () => {
		const app = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3001"],
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve(null);
			},
			loadDashboardSnapshot() {
				return Promise.resolve(createEmptyDashboardSnapshot());
			},
			loadSetupStatus() {
				return Promise.resolve({ setupRequired: true });
			},
			studioBaseUrl: "http://studio.internal",
		});

		const response = await app.request("http://localhost/api/dashboard");

		expect(response.status).toBe(401);
	});

	it("proxies generator routes for authenticated requests", async () => {
		const app = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3001"],
			fetchImpl(input) {
				const url = input instanceof URL ? input : new URL(input.toString());
				return Promise.resolve(
					new Response(JSON.stringify({ url: url.toString() }), {
						headers: {
							"content-type": "application/json",
						},
						status: 200,
					})
				);
			},
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			loadDashboardSnapshot() {
				return Promise.resolve(createEmptyDashboardSnapshot());
			},
			loadSetupStatus() {
				return Promise.resolve({ setupRequired: false });
			},
			studioBaseUrl: "http://studio.internal",
		});

		const response = await app.request(
			"http://localhost/api/scenarios?limit=5"
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			url: "http://studio.internal/api/scenarios?limit=5",
		});
	});

	it("accepts token-protected internal training enqueue requests", async () => {
		const app = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3001"],
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve(null);
			},
			internalTrainingControlService: {
				enqueue() {
					return Promise.resolve({
						accepted: true as const,
						jobId: "training-job-1",
					});
				},
			},
			loadDashboardSnapshot() {
				return Promise.resolve(createEmptyDashboardSnapshot());
			},
			loadSetupStatus() {
				return Promise.resolve({ setupRequired: false });
			},
			studioBaseUrl: "http://studio.internal",
		});

		const response = await app.request(
			"http://localhost/api/internal/person-lora-trainings",
			{
				body: JSON.stringify({
					personId: "person-1",
					personName: "Person",
					personSlug: "person",
					referencePhotoUrl: "https://assets.example.com/reference.png",
				}),
				headers: {
					authorization: "Bearer local-training-control-token",
					"content-type": "application/json",
				},
				method: "POST",
			}
		);

		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({
			accepted: true,
			jobId: "training-job-1",
		});
	});

	it("exposes setup status without requiring a session", async () => {
		const app = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3001"],
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve(null);
			},
			loadDashboardSnapshot() {
				return Promise.resolve(createEmptyDashboardSnapshot());
			},
			loadSetupStatus() {
				return Promise.resolve({ setupRequired: true });
			},
			studioBaseUrl: "http://studio.internal",
		});

		const response = await app.request("http://localhost/api/setup/status");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			setupRequired: true,
		});
	});
});
