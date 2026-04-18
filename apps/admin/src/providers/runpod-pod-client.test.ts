import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { RunpodPodClient } from "@/providers/runpod-pod-client";

const POD_CREATE_503_PATTERN = /RunPod \/pods \(create\) failed \(503/;
const ALL_TYPES_FAILED_PATTERN =
	/failed for all 2 gpu types[\s\S]*RTX 5090[\s\S]*RTX A5000/;
const STATUS_401_PATTERN = /401/;
const NO_RESOURCES_PATTERN = /does not have the resources/;

interface FetchCall {
	body: unknown;
	headers: Record<string, string>;
	method: string;
	url: string;
}

function captureFetch(response: Response): {
	calls: FetchCall[];
	fetchImpl: typeof fetch;
} {
	const calls: FetchCall[] = [];
	const fetchImpl = mock((input, init) => {
		const headers: Record<string, string> = {};
		if (init?.headers) {
			for (const [key, value] of Object.entries(
				init.headers as Record<string, string>
			)) {
				headers[key.toLowerCase()] = value;
			}
		}
		calls.push({
			body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
			headers,
			method: (init?.method ?? "GET").toUpperCase(),
			url: String(input),
		});
		return Promise.resolve(response.clone());
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

describe("RunpodPodClient", () => {
	beforeEach(() => {
		mock.restore();
	});
	afterEach(() => {
		mock.restore();
	});

	it("createPod posts to /v1/pods with bearer auth and parses response", async () => {
		const { calls, fetchImpl } = captureFetch(
			new Response(
				JSON.stringify({
					desiredStatus: "RUNNING",
					id: "pod-abc",
					name: "ai-toolkit-test",
				}),
				{ headers: { "content-type": "application/json" }, status: 201 }
			)
		);
		const client = new RunpodPodClient({
			apiKey: "rpa_test",
			baseUrl: "https://rest.runpod.io/v1",
			fetchImpl,
		});

		const pod = await client.createPod({
			env: { DATASET_URL: "https://example/data.zip" },
			gpuTypeIds: ["NVIDIA RTX A4000"],
			imageName: "runpod/pytorch:2.4.0",
			name: "ai-toolkit-test",
		});

		expect(pod.id).toBe("pod-abc");
		expect(pod.desiredStatus).toBe("RUNNING");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://rest.runpod.io/v1/pods");
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.headers.authorization).toBe("Bearer rpa_test");
		const body = calls[0]?.body as Record<string, unknown>;
		expect(body.imageName).toBe("runpod/pytorch:2.4.0");
		expect(body.gpuTypeIds).toEqual(["NVIDIA RTX A4000"]);
		// Always inject availability priority — RunPod scheduler doesn't apply
		// the documented default reliably (verified empirically).
		expect(body.gpuTypePriority).toBe("availability");
	});

	it("createPod respects explicit gpuTypePriority=custom", async () => {
		const { calls, fetchImpl } = captureFetch(
			new Response(JSON.stringify({ desiredStatus: "RUNNING", id: "pod-x" }), {
				headers: { "content-type": "application/json" },
				status: 201,
			})
		);
		const client = new RunpodPodClient({ apiKey: "rpa", fetchImpl });
		await client.createPod({
			env: {},
			gpuTypeIds: ["A", "B"],
			gpuTypePriority: "custom",
			imageName: "img",
			name: "n",
		});
		const body = calls[0]?.body as Record<string, unknown>;
		expect(body.gpuTypePriority).toBe("custom");
	});

	it("getPod fetches /v1/pods/{id} and surfaces desiredStatus", async () => {
		const { calls, fetchImpl } = captureFetch(
			new Response(JSON.stringify({ desiredStatus: "EXITED", id: "pod-abc" }), {
				headers: { "content-type": "application/json" },
				status: 200,
			})
		);
		const client = new RunpodPodClient({ apiKey: "rpa", fetchImpl });

		const pod = await client.getPod("pod-abc");
		expect(pod.desiredStatus).toBe("EXITED");
		expect(calls[0]?.url).toBe("https://rest.runpod.io/v1/pods/pod-abc");
		expect(calls[0]?.method).toBe("GET");
	});

	it("createPod surfaces detailed error message from non-2xx response", async () => {
		const { fetchImpl } = captureFetch(
			new Response(JSON.stringify({ message: "no GPUs" }), {
				headers: { "content-type": "application/json" },
				status: 503,
			})
		);
		const client = new RunpodPodClient({ apiKey: "rpa", fetchImpl });

		await expect(
			client.createPod({
				env: {},
				gpuTypeIds: ["X"],
				imageName: "img",
				name: "n",
			})
		).rejects.toThrow(POD_CREATE_503_PATTERN);
	});

	it("createPod falls back to per-gpu requests when bulk-availability fails", async () => {
		// Главный путь — один POST с массивом + gpuTypePriority=availability.
		// Если scheduler флакает (бывает) — клиент делает ещё N запросов, по одному
		// gpu type на каждый. 1 bulk + 3 single = 4 attempts.
		const responses: Response[] = [
			new Response(
				JSON.stringify({
					error:
						"create pod: This machine does not have the resources to deploy your pod",
				}),
				{ headers: { "content-type": "application/json" }, status: 500 }
			),
			new Response(
				JSON.stringify({
					error:
						"create pod: This machine does not have the resources to deploy your pod",
				}),
				{ headers: { "content-type": "application/json" }, status: 500 }
			),
			new Response(
				JSON.stringify({
					error: "create pod: There are no instances currently available",
				}),
				{ headers: { "content-type": "application/json" }, status: 500 }
			),
			new Response(
				JSON.stringify({ desiredStatus: "RUNNING", id: "pod-on-l40s" }),
				{ headers: { "content-type": "application/json" }, status: 201 }
			),
		];
		let callIndex = 0;
		const sentPayloads: unknown[] = [];
		const fetchImpl = mock((_input, init) => {
			sentPayloads.push(
				init?.body ? (JSON.parse(String(init.body)) as unknown) : null
			);
			const response = responses[callIndex++];
			if (!response) {
				throw new Error("Unexpected extra fetch call");
			}
			return Promise.resolve(response);
		}) as unknown as typeof fetch;
		const client = new RunpodPodClient({ apiKey: "rpa", fetchImpl });

		const pod = await client.createPod({
			env: {},
			gpuTypeIds: [
				"NVIDIA GeForce RTX 5090",
				"NVIDIA RTX A5000",
				"NVIDIA L40S",
			],
			imageName: "img",
			name: "n",
		});

		expect(pod.id).toBe("pod-on-l40s");
		expect(callIndex).toBe(4);
		const sentGpus = sentPayloads.map(
			(p) => (p as { gpuTypeIds?: string[] }).gpuTypeIds
		);
		// 1) bulk: все три, в исходном порядке
		expect(sentGpus[0]).toEqual([
			"NVIDIA GeForce RTX 5090",
			"NVIDIA RTX A5000",
			"NVIDIA L40S",
		]);
		// 2..4) single: по одному
		expect(sentGpus[1]).toEqual(["NVIDIA GeForce RTX 5090"]);
		expect(sentGpus[2]).toEqual(["NVIDIA RTX A5000"]);
		expect(sentGpus[3]).toEqual(["NVIDIA L40S"]);
	});

	it("createPod with single gpu type does NOT enter sequential fallback", async () => {
		// gpuTypeIds.length === 1 — фоллбэку нечего делать, должен сразу пробросить.
		let callCount = 0;
		const fetchImpl = mock(() => {
			callCount++;
			return Promise.resolve(
				new Response(
					JSON.stringify({
						error:
							"create pod: This machine does not have the resources to deploy your pod",
					}),
					{ headers: { "content-type": "application/json" }, status: 500 }
				)
			);
		}) as unknown as typeof fetch;
		const client = new RunpodPodClient({ apiKey: "rpa", fetchImpl });

		await expect(
			client.createPod({
				env: {},
				gpuTypeIds: ["NVIDIA GeForce RTX 5090"],
				imageName: "img",
				name: "n",
			})
		).rejects.toThrow(NO_RESOURCES_PATTERN);
		expect(callCount).toBe(1);
	});

	it("createPod throws aggregated error when every gpu type lacks capacity", async () => {
		// 1 bulk + 2 single = 3 capacity fails, дальше aggregated.
		const fetchImpl = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error:
							"create pod: This machine does not have the resources to deploy your pod",
					}),
					{ headers: { "content-type": "application/json" }, status: 500 }
				)
			)
		) as unknown as typeof fetch;
		const client = new RunpodPodClient({ apiKey: "rpa", fetchImpl });

		await expect(
			client.createPod({
				env: {},
				gpuTypeIds: ["NVIDIA GeForce RTX 5090", "NVIDIA RTX A5000"],
				imageName: "img",
				name: "n",
			})
		).rejects.toThrow(ALL_TYPES_FAILED_PATTERN);
	});

	it("createPod does NOT retry on non-capacity errors (auth, validation, etc.)", async () => {
		let callCount = 0;
		const fetchImpl = mock(() => {
			callCount++;
			return Promise.resolve(
				new Response(JSON.stringify({ error: "Unauthorized" }), {
					headers: { "content-type": "application/json" },
					status: 401,
				})
			);
		}) as unknown as typeof fetch;
		const client = new RunpodPodClient({ apiKey: "rpa", fetchImpl });

		await expect(
			client.createPod({
				env: {},
				gpuTypeIds: ["A", "B", "C"],
				imageName: "img",
				name: "n",
			})
		).rejects.toThrow(STATUS_401_PATTERN);
		expect(callCount).toBe(1);
	});

	it("deletePod is best-effort and does not throw on errors", async () => {
		const fetchImpl = mock(() => {
			throw new Error("network down");
		}) as unknown as typeof fetch;
		const client = new RunpodPodClient({ apiKey: "rpa", fetchImpl });

		await client.deletePod("pod-abc");
	});
});
