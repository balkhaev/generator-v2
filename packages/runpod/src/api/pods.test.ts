import { describe, expect, it, mock } from "bun:test";

import { createRunpodHttpClient } from "../http/client";
import { createPodsApi } from "./pods";

const NO_CAPACITY_PATTERN = /no capacity for any of 2 gpu types/;

function createApi(fetchImpl: ReturnType<typeof mock>) {
	const http = createRunpodHttpClient({
		apiKey: "rpa_test",
		baseUrl: "https://rest.runpod.io/v1",
		fetchImpl,
	});
	return createPodsApi(http);
}

describe("RunpodPodsApi", () => {
	it("creates a pod with the given spec and default gpuTypePriority", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe("https://rest.runpod.io/v1/pods");
			expect(init?.method).toBe("POST");
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			expect(body).toMatchObject({
				cloudType: "SECURE",
				gpuTypeIds: ["NVIDIA RTX A6000"],
				gpuTypePriority: "availability",
				imageName: "runpod/pytorch:test",
				name: "smoke-test",
			});
			return Promise.resolve(
				Response.json({ id: "pod-1", desiredStatus: "RUNNING" })
			);
		});
		const api = createApi(fetchImpl);

		const pod = await api.create({
			cloudType: "SECURE",
			env: { HELLO: "world" },
			gpuTypeIds: ["NVIDIA RTX A6000"],
			imageName: "runpod/pytorch:test",
			name: "smoke-test",
		});

		expect(pod.id).toBe("pod-1");
	});

	it("falls back across gpuTypeIds when capacity is missing", async () => {
		const calls: string[] = [];
		const fetchImpl = mock((_url: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			const gpuTypes = body.gpuTypeIds as string[];
			calls.push(gpuTypes.join(","));
			if (gpuTypes.length > 1 || gpuTypes[0] === "A40") {
				return Promise.resolve(
					Response.json(
						{ error: "no instances available right now" },
						{ status: 503 }
					)
				);
			}
			return Promise.resolve(
				Response.json({ id: "pod-2", desiredStatus: "RUNNING" })
			);
		});
		const api = createApi(fetchImpl);

		const pod = await api.create({
			env: {},
			gpuTypeIds: ["A40", "RTX 4090"],
			imageName: "runpod/pytorch:test",
			name: "fallback-test",
		});

		expect(pod.id).toBe("pod-2");
		expect(calls).toEqual(["A40,RTX 4090", "A40", "RTX 4090"]);
	});

	it("aggregates errors when all gpu types lack capacity", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(Response.json({ error: "out of stock" }, { status: 503 }))
		);
		const api = createApi(fetchImpl);

		await expect(
			api.create({
				env: {},
				gpuTypeIds: ["A40", "RTX 4090"],
				imageName: "runpod/pytorch:test",
				name: "no-capacity",
			})
		).rejects.toThrow(NO_CAPACITY_PATTERN);
	});

	it("rejects an empty gpuTypeIds list immediately", async () => {
		const api = createApi(mock(() => Promise.reject(new Error("noop"))));
		await expect(
			api.create({
				env: {},
				gpuTypeIds: [],
				imageName: "x",
				name: "y",
			})
		).rejects.toThrow("gpuTypeIds is empty");
	});

	it("issues DELETE on /pods/<id>", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe("https://rest.runpod.io/v1/pods/pod-1");
			expect(init?.method).toBe("DELETE");
			return Promise.resolve(new Response(null, { status: 204 }));
		});
		const api = createApi(fetchImpl);
		await api.delete("pod-1");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("parses pod snapshots and exposes desiredStatus", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				Response.json({
					id: "pod-1",
					name: "ltx",
					desiredStatus: "EXITED",
				})
			)
		);
		const api = createApi(fetchImpl);
		const pod = await api.get("pod-1");
		expect(pod.id).toBe("pod-1");
		expect(pod.desiredStatus).toBe("EXITED");
	});
});
