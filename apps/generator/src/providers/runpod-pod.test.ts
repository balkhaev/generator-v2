import { describe, expect, it, mock } from "bun:test";
import type { S3StorageConfig } from "@generator/storage";

import {
	createRunpodPodInferenceClient,
	formatRunpodPodJobId,
	formatRunpodPodProviderEndpointId,
	parseRunpodPodJobId,
} from "@/providers/runpod-pod";

const s3Config: S3StorageConfig = {
	accessKeyId: "access-key",
	bucket: "assets",
	endpoint: "https://s3.example.com",
	publicBaseUrl: "https://assets.example.com",
	region: "hel1",
	secretAccessKey: "secret",
};
const podJobIdPattern = /^pod-123:[0-9a-f-]+$/u;

describe("runpod pod provider", () => {
	it("formats and parses provider job ids", () => {
		const jobId = formatRunpodPodJobId({
			podId: "pod-123",
			requestId: "request-456",
		});
		expect(jobId).toBe("pod-123:request-456");
		expect(parseRunpodPodJobId(jobId)).toEqual({
			podId: "pod-123",
			requestId: "request-456",
		});
		expect(() => parseRunpodPodJobId("bad")).toThrow(
			"RunPod Pod job id must be formatted as podId:requestId"
		);
	});

	it("creates a disposable pod with S3 upload URLs in the environment", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe("https://rest.runpod.io/v1/pods");
			expect(init?.method).toBe("POST");
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			expect(body).toMatchObject({
				cloudType: "SECURE",
				containerDiskInGb: 80,
				gpuCount: 1,
				gpuTypeIds: ["NVIDIA RTX A6000"],
				gpuTypePriority: "availability",
				imageName: "runpod/pytorch:test",
				supportPublicIp: false,
				volumeInGb: 160,
				volumeMountPath: "/workspace",
			});
			expect(body.dockerStartCmd).toEqual([
				"bash",
				"-lc",
				'curl -sSfL "https://cdn.example.com/pod-bootstrap.sh" | bash',
			]);
			const env = body.env as Record<string, string>;
			expect(env).toMatchObject({
				CFG_SCALE: "1",
				CIVITAI_API_KEY: "civitai-token",
				FPS: "24",
				HEIGHT: "1280",
				HF_TOKEN: "hf-token",
				INPUT_IMAGE_URL: "https://example.com/input.png",
				LORA_NAME: "ltxv/ltx2/custom-lora.safetensors",
				LORA_URL: "",
				NUM_FRAMES: "241",
				OUTPUT_CONTENT_TYPE: "video/mp4",
				POD_RUNNER_URL: "https://cdn.example.com/pod_runner.py",
				PROMPT: "test prompt",
				STEPS: "8",
				WIDTH: "896",
			});
			expect(env.OUTPUT_UPLOAD_URL).toContain(
				"generator-artifacts/runpod-pod/"
			);
			expect(env.LOG_UPLOAD_URL).toContain("generator-artifacts/runpod-pod/");
			return Promise.resolve(
				Response.json({
					desiredStatus: "RUNNING",
					id: "pod-123",
					name: "ltx23-synth-test",
				})
			);
		});
		const createPutUrl = mock((input: { key: string }) => {
			return `https://uploads.example.com/${input.key}`;
		});
		const client = createRunpodPodInferenceClient({
			apiKey: "runpod-token",
			civitaiApiKey: "civitai-token",
			fetchImpl,
			hfToken: "hf-token",
			s3Config,
			workflows: {
				"ltx-2-3-video": {
					bootstrapUrl: "https://cdn.example.com/pod-bootstrap.sh",
					cloudType: "SECURE",
					containerDiskInGb: 80,
					gpuTypeIds: ["NVIDIA RTX A6000"],
					imageName: "runpod/pytorch:test",
					namePrefix: "ltx23-synth",
					podRunnerUrl: "https://cdn.example.com/pod_runner.py",
					volumeInGb: 160,
				},
			},
			createPutUrl: createPutUrl as never,
		});

		const submission = await client.submit({
			__runpodPod: "ltx-2-3-video",
			cfgScale: 1,
			fps: 24,
			height: 1280,
			inputImageUrl: "https://example.com/input.png",
			numFrames: 241,
			prompt: "test prompt",
			steps: 8,
			width: 896,
		});

		expect(submission.endpointId).toBe(
			formatRunpodPodProviderEndpointId("ltx-2-3-video")
		);
		expect(submission.jobId).toMatch(podJobIdPattern);
		expect(submission.status).toBe("queued");
		expect(createPutUrl).toHaveBeenCalledTimes(2);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("returns succeeded when the expected S3 output exists and deletes the pod", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe("https://rest.runpod.io/v1/pods/pod-123");
			expect(init?.method).toBe("DELETE");
			return Promise.resolve(new Response(null, { status: 204 }));
		});
		const statObject = mock((key: string) => ({
			etag: "etag",
			key,
			lastModified: new Date("2026-01-01T00:00:00Z"),
			sizeBytes: 1024,
			type: "video/mp4",
			url: `https://assets.example.com/${key}`,
		}));
		const client = createRunpodPodInferenceClient({
			apiKey: "runpod-token",
			fetchImpl,
			s3Config,
			statObject: statObject as never,
			workflows: {
				"ltx-2-3-synth-video": {
					bootstrapUrl: "https://cdn.example.com/pod-bootstrap.sh",
					gpuTypeIds: ["NVIDIA RTX A6000"],
					imageName: "runpod/pytorch:test",
				},
			},
		});

		const job = await client.getStatus(
			"pod-123:request-456",
			formatRunpodPodProviderEndpointId("ltx-2-3-synth-video")
		);

		expect(job).toMatchObject({
			errorSummary: null,
			output: {
				podId: "pod-123",
				videoUrl:
					"https://assets.example.com/generator-artifacts/runpod-pod/request-456/output.mp4",
			},
			progressPct: 100,
			status: "succeeded",
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("fails terminated pods that never uploaded an artifact", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			if (init?.method === "DELETE") {
				return Promise.resolve(new Response(null, { status: 204 }));
			}
			expect(url).toBe("https://rest.runpod.io/v1/pods/pod-123");
			return Promise.resolve(
				Response.json({
					desiredStatus: "EXITED",
					id: "pod-123",
				})
			);
		});
		const statObject = mock(() => {
			throw new Error("not found");
		});
		const client = createRunpodPodInferenceClient({
			apiKey: "runpod-token",
			fetchImpl,
			s3Config,
			statObject: statObject as never,
			workflows: {
				"ltx-2-3-synth-video": {
					bootstrapUrl: "https://cdn.example.com/pod-bootstrap.sh",
					gpuTypeIds: ["NVIDIA RTX A6000"],
					imageName: "runpod/pytorch:test",
				},
			},
		});

		const job = await client.getStatus(
			"pod-123:request-456",
			formatRunpodPodProviderEndpointId("ltx-2-3-synth-video")
		);

		expect(job.status).toBe("failed");
		expect(job.errorSummary).toContain("finished without uploading output");
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});
