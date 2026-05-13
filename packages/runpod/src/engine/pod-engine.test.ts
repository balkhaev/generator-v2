import { describe, expect, it, mock } from "bun:test";
import type { S3ObjectStat, S3StorageConfig } from "@generator/storage";
import { z } from "zod";

import type { PodSnapshot, RunpodPodsApi } from "../api/pods";
import type { ComfyUIClient } from "../comfyui/client";
import type {
	ComfyUIHistoryItem,
	ComfyUIQueueResponse,
	ComfyUISystemStats,
	ComfyUIUserdataEntry,
} from "../comfyui/types";
import type { PodWorkflow } from "../workflow/definition";
import {
	createPodEngine,
	formatPodJobId,
	isComfyTransientProxyError,
	isPodNotFoundError,
	parsePodJobId,
} from "./pod-engine";

const s3: S3StorageConfig = {
	accessKeyId: "access",
	bucket: "assets",
	endpoint: "https://s3.example.com",
	publicBaseUrl: "https://assets.example.com",
	region: "hel1",
	secretAccessKey: "secret",
};

const ltxInputSchema = z.object({ prompt: z.string() });

interface VideoOutput {
	podId: string;
	requestId: string;
	videoUrl: string;
}

const baseWorkflow: PodWorkflow<z.infer<typeof ltxInputSchema>, VideoOutput> = {
	artifactContentType: "video/mp4",
	id: "ltx-2-3-video",
	inputSchema: ltxInputSchema,
	mode: "pod",
	pod: {
		imageName: "ls250824/run-comfyui-ltx:test",
		namePrefix: "ltx23",
		networkVolumes: [
			{
				gpuTypeIds: ["NVIDIA RTX A6000"],
				label: "test-dc",
				networkVolumeId: "vol-test",
			},
		],
		templateId: "p4f6rm9tb4",
	},
	buildPrompt: () => ({ prompt: { "1": { class_type: "Foo", inputs: {} } } }),
	parseOutput: (ctx) => ({
		podId: ctx.podId,
		requestId: ctx.requestId,
		videoUrl: ctx.artifactPublicUrl,
	}),
};

function buildApi(overrides: Partial<RunpodPodsApi> = {}): RunpodPodsApi {
	return {
		create:
			overrides.create ??
			mock(() => Promise.resolve<PodSnapshot>({ id: "pod-1" })),
		delete: overrides.delete ?? mock(() => Promise.resolve()),
		get:
			overrides.get ??
			mock(() => Promise.resolve<PodSnapshot>({ id: "pod-1" })),
	};
}

function makeStat(key: string, sizeBytes: number): S3ObjectStat {
	return {
		etag: "etag",
		key,
		lastModified: new Date(),
		sizeBytes,
		type: "video/mp4",
		url: `https://assets.example.com/${key}`,
	};
}

interface ClientStubOverrides {
	downloadArtifact?: ComfyUIClient["downloadArtifact"];
	getHistory?: () => Promise<Record<string, ComfyUIHistoryItem>>;
	getObjectInfo?: ComfyUIClient["getObjectInfo"];
	getQueue?: () => Promise<ComfyUIQueueResponse>;
	getSystemStats?: () => Promise<ComfyUISystemStats>;
	listUserdata?: () => Promise<ComfyUIUserdataEntry[]>;
	submitPrompt?: ComfyUIClient["submitPrompt"];
}

function buildClientStub(overrides: ClientStubOverrides = {}): ComfyUIClient {
	const dummy = mock(() => Promise.reject(new Error("not stubbed")));
	const userdataEntries: ComfyUIUserdataEntry[] = Array.from(
		{ length: 6 },
		(_, i) => ({
			name: `wf-${i}.json`,
			path: `workflows/wf-${i}.json`,
			type: "file" as const,
		})
	);
	return {
		authorizedFetch: dummy as never,
		cancelDownload: dummy as never,
		downloadArtifact:
			overrides.downloadArtifact ??
			(mock(() => Promise.resolve(new ArrayBuffer(8))) as never),
		getCivitaiVersionInfo: dummy as never,
		getHistory: overrides.getHistory ?? (() => Promise.resolve({})),
		getLoraManagerLibraries: dummy as never,
		getLoraManagerSettings: dummy as never,
		getObjectInfo: overrides.getObjectInfo ?? (dummy as never),
		getHistoryEntry: dummy as never,
		getQueue:
			overrides.getQueue ??
			(() =>
				Promise.resolve({
					queue_pending: [],
					queue_running: [],
				})),
		getSystemStats:
			overrides.getSystemStats ??
			(() =>
				Promise.resolve({
					devices: [],
					system: { os: "linux", ram_free: 0, ram_total: 0 },
				})),
		listUserdata:
			overrides.listUserdata ?? (() => Promise.resolve(userdataEntries)),
		login: () => Promise.resolve(),
		pollLoraDownload: dummy as never,
		readUserdata: dummy as never,
		startLoraDownload: dummy as never,
		submitPrompt:
			overrides.submitPrompt ??
			(mock(() => Promise.resolve({ number: 1, prompt_id: "p-1" })) as never),
		updateLoraManagerSettings: dummy as never,
		uploadInputImage: dummy as never,
	};
}

describe("podJobId helpers", () => {
	it("formats and parses pod job ids", () => {
		const jobId = formatPodJobId({
			password: "pwd",
			podId: "pod-1",
			requestId: "req-1",
		});
		expect(jobId).toBe("pod-1:req-1:pwd");
		expect(parsePodJobId(jobId)).toEqual({
			password: "pwd",
			podId: "pod-1",
			requestId: "req-1",
		});
		expect(() => parsePodJobId("bad")).toThrow();
		expect(() => parsePodJobId("a:b")).toThrow();
		expect(() => parsePodJobId("a::b")).toThrow();
	});
});

const NO_CAPACITY_ACROSS_VOLUMES_PATTERN =
	/no capacity across 2 network volume/u;

describe("PodEngine submit", () => {
	it("creates a pod without dockerStartCmd and serialises input into env", async () => {
		const create = mock((spec: { env: Record<string, string> }) => {
			expect(spec).not.toHaveProperty("dockerStartCmd");
			expect(spec.env.PASSWORD).toBe("fixed-password");
			expect(spec.env.CIVITAI_TOKEN).toBe("civitai-key");
			expect(spec.env.HF_TOKEN).toBe("hf-token");
			const decoded = JSON.parse(
				Buffer.from(
					spec.env.INFERENCE_INPUT_JSON_B64 as string,
					"base64"
				).toString("utf8")
			);
			expect(decoded).toEqual({ prompt: "hello" });
			return Promise.resolve<PodSnapshot>({
				desiredStatus: "RUNNING",
				id: "pod-XYZ",
			});
		});
		const engine = createPodEngine({
			api: buildApi({ create }),
			civitaiApiKey: "civitai-key",
			hfToken: "hf-token",
			randomPassword: () => "fixed-password",
			randomRequestId: () => "req-fixed",
			s3,
			workflow: baseWorkflow,
		});
		const submission = await engine.submit({ prompt: "hello" });
		expect(submission.jobId).toBe("pod-XYZ:req-fixed:fixed-password");
		expect(submission.status).toBe("queued");
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("passes networkVolumeId and gpuTypeIds from the first volume to the API", async () => {
		const seenPayloads: Array<{
			gpuTypeIds: string[];
			networkVolumeId?: string;
		}> = [];
		const create = mock(
			(spec: { gpuTypeIds: string[]; networkVolumeId?: string }) => {
				seenPayloads.push({
					gpuTypeIds: spec.gpuTypeIds,
					networkVolumeId: spec.networkVolumeId,
				});
				return Promise.resolve<PodSnapshot>({ id: "pod-multi" });
			}
		);
		const engine = createPodEngine({
			api: buildApi({ create }),
			s3,
			workflow: {
				...baseWorkflow,
				pod: {
					...baseWorkflow.pod,
					networkVolumes: [
						{
							gpuTypeIds: ["NVIDIA RTX A6000"],
							label: "EU-RO-1",
							networkVolumeId: "vol-eu",
						},
						{
							gpuTypeIds: ["NVIDIA H100 80GB HBM3"],
							label: "US-KS-2",
							networkVolumeId: "vol-us",
						},
					],
				},
			},
		});
		await engine.submit({ prompt: "hi" });
		expect(seenPayloads).toHaveLength(1);
		expect(seenPayloads[0]?.networkVolumeId).toBe("vol-eu");
		expect(seenPayloads[0]?.gpuTypeIds).toEqual(["NVIDIA RTX A6000"]);
	});

	it("falls back to the next volume when the first one has no capacity", async () => {
		const seen: string[] = [];
		const create = mock(
			(spec: { gpuTypeIds: string[]; networkVolumeId?: string }) => {
				seen.push(spec.networkVolumeId ?? "<none>");
				if (spec.networkVolumeId === "vol-eu") {
					return Promise.reject(
						new Error(
							"runpod /pods (create): no capacity for any of 1 gpu types"
						)
					);
				}
				return Promise.resolve<PodSnapshot>({ id: "pod-us" });
			}
		);
		const engine = createPodEngine({
			api: buildApi({ create }),
			s3,
			workflow: {
				...baseWorkflow,
				pod: {
					...baseWorkflow.pod,
					networkVolumes: [
						{
							gpuTypeIds: ["NVIDIA RTX A6000"],
							label: "EU-RO-1",
							networkVolumeId: "vol-eu",
						},
						{
							gpuTypeIds: ["NVIDIA H100 80GB HBM3"],
							label: "US-KS-2",
							networkVolumeId: "vol-us",
						},
					],
				},
			},
		});
		const submission = await engine.submit({ prompt: "hi" });
		expect(seen).toEqual(["vol-eu", "vol-us"]);
		expect(submission.rawProviderJobReference).toBe("pod-us");
	});

	it("aggregates errors when every volume returns no-capacity", async () => {
		const create = mock(() =>
			Promise.reject(
				new Error("runpod /pods (create): no capacity for any of 1 gpu types")
			)
		);
		const engine = createPodEngine({
			api: buildApi({ create }),
			s3,
			workflow: {
				...baseWorkflow,
				pod: {
					...baseWorkflow.pod,
					networkVolumes: [
						{
							gpuTypeIds: ["NVIDIA RTX A6000"],
							label: "EU-RO-1",
							networkVolumeId: "vol-eu",
						},
						{
							gpuTypeIds: ["NVIDIA H100 80GB HBM3"],
							label: "US-KS-2",
							networkVolumeId: "vol-us",
						},
					],
				},
			},
		});
		await expect(engine.submit({ prompt: "hi" })).rejects.toThrow(
			NO_CAPACITY_ACROSS_VOLUMES_PATTERN
		);
	});
});

describe("PodEngine getStatus", () => {
	const jobId = "pod-XYZ:req-fixed:pwd";

	it("returns succeeded when the artifact already exists in S3", async () => {
		const deleteFn = mock(() => Promise.resolve());
		const statObject = mock((key: string) =>
			Promise.resolve(makeStat(key, 2048))
		);
		const engine = createPodEngine({
			api: buildApi({ delete: deleteFn }),
			createClient: () => buildClientStub(),
			s3,
			statObject: statObject as never,
			workflow: baseWorkflow,
		});
		const job = await engine.getStatus(jobId);
		expect(job.status).toBe("succeeded");
		expect(job.output).toEqual({
			podId: "pod-XYZ",
			requestId: "req-fixed",
			videoUrl:
				"https://assets.example.com/generator-artifacts/runpod-pod/req-fixed/output.mp4",
		});
		expect(deleteFn).toHaveBeenCalledWith("pod-XYZ");
	});

	it("fails terminated pods that never produced an artifact", async () => {
		const deleteFn = mock(() => Promise.resolve());
		const engine = createPodEngine({
			api: buildApi({
				delete: deleteFn,
				get: () =>
					Promise.resolve<PodSnapshot>({
						desiredStatus: "EXITED",
						id: "pod-XYZ",
					}),
			}),
			createClient: () => buildClientStub(),
			s3,
			statObject: (() => {
				throw new Error("not found");
			}) as never,
			workflow: baseWorkflow,
		});
		const job = await engine.getStatus(jobId);
		expect(job.status).toBe("failed");
		expect(job.errorSummary).toContain("EXITED");
		expect(deleteFn).toHaveBeenCalledTimes(1);
	});

	it("returns running while ComfyUI is not ready yet", async () => {
		const engine = createPodEngine({
			api: buildApi({
				get: () =>
					Promise.resolve<PodSnapshot>({
						desiredStatus: "RUNNING",
						id: "pod-XYZ",
					}),
			}),
			createClient: () =>
				buildClientStub({
					getSystemStats: () => Promise.reject(new Error("auth")),
				}),
			s3,
			statObject: (() => {
				throw new Error("not found");
			}) as never,
			workflow: baseWorkflow,
		});
		const job = await engine.getStatus(jobId);
		expect(job.status).toBe("running");
		expect(job.progressPct).toBeGreaterThanOrEqual(0);
	});

	it("submits prompt when ComfyUI is ready and no entry exists yet", async () => {
		const submitPrompt = mock(() =>
			Promise.resolve({ number: 1, prompt_id: "p-1" })
		);
		const engine = createPodEngine({
			api: buildApi({
				get: () =>
					Promise.resolve({
						desiredStatus: "RUNNING",
						env: {
							INFERENCE_INPUT_JSON_B64: encodeBase64Json({ prompt: "p" }),
						},
						id: "pod-XYZ",
					} as never),
			}),
			createClient: () =>
				buildClientStub({ submitPrompt: submitPrompt as never }),
			s3,
			statObject: (() => {
				throw new Error("not found");
			}) as never,
			workflow: baseWorkflow,
		});
		const job = await engine.getStatus(jobId);
		expect(job.status).toBe("running");
		expect(submitPrompt).toHaveBeenCalledTimes(1);
	});

	it("downloads artifact and uploads to S3 when /history has matching client_id", async () => {
		const uploadObject = mock(() =>
			Promise.resolve({
				key: "k",
				sizeBytes: 8,
				url: "https://assets.example.com/k",
			})
		);
		const deleteFn = mock(() => Promise.resolve());
		let statCall = 0;
		const statObject = mock((key: string) => {
			statCall += 1;
			if (statCall === 1) {
				throw new Error("not found");
			}
			return Promise.resolve(makeStat(key, 16));
		});
		const engine = createPodEngine({
			api: buildApi({
				delete: deleteFn,
				get: () =>
					Promise.resolve({
						desiredStatus: "RUNNING",
						env: {
							INFERENCE_INPUT_JSON_B64: encodeBase64Json({ prompt: "p" }),
						},
						id: "pod-XYZ",
					} as never),
			}),
			createClient: () =>
				buildClientStub({
					getHistory: () =>
						Promise.resolve({
							"p-1": {
								outputs: {
									"42": {
										videos: [
											{
												filename: "out.mp4",
												subfolder: "",
												type: "output",
											},
										],
									},
								},
								prompt: [1, "p-1", {}, { client_id: "req-fixed" }, ["42"]],
								status: { completed: true, status_str: "success" },
							},
						}),
				}),
			s3,
			statObject: statObject as never,
			uploadObject: uploadObject as never,
			workflow: baseWorkflow,
		});
		const job = await engine.getStatus(jobId);
		expect(job.status).toBe("succeeded");
		expect(uploadObject).toHaveBeenCalledTimes(1);
		expect(deleteFn).toHaveBeenCalledWith("pod-XYZ");
	});
});

describe("PodEngine cancel", () => {
	it("issues delete on the parsed podId", async () => {
		const deleteFn = mock(() => Promise.resolve());
		const engine = createPodEngine({
			api: buildApi({ delete: deleteFn }),
			createClient: () => buildClientStub(),
			s3,
			workflow: baseWorkflow,
		});
		await engine.cancel("pod-A:req-2:pwd");
		expect(deleteFn).toHaveBeenCalledWith("pod-A");
	});
});

describe("error helpers", () => {
	it("recognises comfyui Cloudflare proxy 5xx as transient", () => {
		expect(
			isComfyTransientProxyError(
				new Error("comfyui /history failed (502): <html>Bad gateway</html>")
			)
		).toBe(true);
		expect(
			isComfyTransientProxyError(
				new Error("comfyui /queue failed (524): timeout")
			)
		).toBe(true);
		expect(
			isComfyTransientProxyError(
				new Error("comfyui /system_stats: fetch failed (TLS)")
			)
		).toBe(true);
	});

	it("does not flag deterministic comfyui errors as transient", () => {
		expect(
			isComfyTransientProxyError(
				new Error("comfyui /prompt failed (400): value_not_in_list")
			)
		).toBe(false);
		expect(
			isComfyTransientProxyError(
				new Error("comfyui /prompt failed (401): authentication required")
			)
		).toBe(false);
		expect(
			isComfyTransientProxyError(new Error("runpod /pods (get) failed (502)"))
		).toBe(false);
	});

	it("recognises pod-not-found 404 from runpod API", () => {
		expect(
			isPodNotFoundError(
				new Error("runpod /pods/abcd1234 (get) failed (404): pod not found")
			)
		).toBe(true);
		expect(
			isPodNotFoundError(new Error("runpod /pods (create) failed (404)"))
		).toBe(false);
	});
});

describe("PodEngine getStatus error handling", () => {
	const jobId = "pod-LOST:req-fixed:pwd";

	it("emits a clear error when the pod has vanished from RunPod", async () => {
		const engine = createPodEngine({
			api: buildApi({
				get: () =>
					Promise.reject(
						new Error("runpod /pods/pod-LOST (get) failed (404): pod not found")
					),
			}),
			createClient: () => buildClientStub(),
			s3,
			statObject: (() => {
				throw new Error("not found");
			}) as never,
			workflow: baseWorkflow,
		});
		const job = await engine.getStatus(jobId);
		expect(job.status).toBe("failed");
		expect(job.errorSummary).toContain("vanished");
		expect(job.errorSummary).toContain("pod-LOST");
	});

	it("treats transient ComfyUI proxy 5xx as still running", async () => {
		const engine = createPodEngine({
			api: buildApi({
				get: () =>
					Promise.resolve({
						desiredStatus: "RUNNING",
						env: {
							INFERENCE_INPUT_JSON_B64: encodeBase64Json({ prompt: "p" }),
						},
						id: "pod-LOST",
					} as PodSnapshot & { env: Record<string, string> }),
			}),
			createClient: () =>
				buildClientStub({
					getHistory: () =>
						Promise.reject(
							new Error("comfyui /history failed (502): Bad gateway")
						),
				}),
			s3,
			statObject: (() => {
				throw new Error("not found");
			}) as never,
			workflow: baseWorkflow,
		});
		const job = await engine.getStatus(jobId);
		expect(job.status).toBe("running");
		expect(job.errorSummary).toBeNull();
	});
});

function encodeBase64Json(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}
