import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { RunpodPodClient } from "@/providers/runpod-pod-client";

const POD_CREATE_503_PATTERN = /RunPod \/pods \(create\) failed \(503/;

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

	it("deletePod is best-effort and does not throw on errors", async () => {
		const fetchImpl = mock(() => {
			throw new Error("network down");
		}) as unknown as typeof fetch;
		const client = new RunpodPodClient({ apiKey: "rpa", fetchImpl });

		await client.deletePod("pod-abc");
	});
});
