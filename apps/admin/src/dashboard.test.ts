import { describe, expect, it } from "bun:test";

import { getAdminDashboardSnapshot } from "@/dashboard";

function jsonResponse(body: unknown) {
	return new Response(JSON.stringify(body), {
		headers: {
			"content-type": "application/json",
		},
		status: 200,
	});
}

function getAuthorization(headers: HeadersInit | undefined) {
	if (!headers) {
		return null;
	}

	return new Headers(headers).get("authorization");
}

function getRequestUrl(input: Parameters<typeof fetch>[0]) {
	if (input instanceof Request) {
		return input.url;
	}

	return input.toString();
}

function getRequestHeaders(
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1]
) {
	if (init?.headers) {
		return init.headers;
	}

	return input instanceof Request ? input.headers : undefined;
}

describe("admin dashboard", () => {
	it("loads LoRA training snapshots through the persons internal API", async () => {
		const originalFetch = globalThis.fetch;
		const requests: Array<{ authorization: string | null; url: string }> = [];

		globalThis.fetch = (input, init) => {
			const url = getRequestUrl(input);
			const headers = getRequestHeaders(input, init);
			requests.push({
				authorization: getAuthorization(headers),
				url,
			});

			if (url === "https://studio.example.com/api/studio-snapshot") {
				return Promise.resolve(
					jsonResponse({
						runs: [],
						scenarios: [],
					})
				);
			}

			if (url === "https://persons.example.com/api/internal/persons") {
				return Promise.resolve(
					jsonResponse({
						persons: [
							{
								createdAt: "2026-04-16T10:00:00.000Z",
								datasetUrl: "https://assets.example.com/dataset.zip",
								description: "",
								generations: [],
								id: "person-1",
								loraUrl: null,
								metadata: {
									training: {
										lastEventAt: "2026-04-16T10:01:00.000Z",
										status: "training",
									},
								},
								name: "Demo Person",
								photoUrl: null,
								referencePhotoUrl: "https://assets.example.com/reference.png",
								slug: "demo-person",
								updatedAt: "2026-04-16T10:00:00.000Z",
								videoUrl: null,
								voiceWavUrl: null,
							},
						],
					})
				);
			}

			return Promise.resolve(new Response(null, { status: 404 }));
		};

		try {
			const snapshot = await getAdminDashboardSnapshot(
				"https://studio.example.com",
				"https://persons.example.com",
				"training-token"
			);

			expect(snapshot.notices).toEqual([]);
			expect(snapshot.loraTrainings).toHaveLength(1);
			expect(snapshot.loraTrainings[0]?.personId).toBe("person-1");
			expect(
				requests.find(
					(request) =>
						request.url === "https://persons.example.com/api/internal/persons"
				)?.authorization
			).toBe("Bearer training-token");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
