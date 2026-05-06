import { describe, expect, it } from "bun:test";
import type { S3StorageConfig } from "@generator/storage";

import type { PodRuntimeContext } from "../workflow/definition";
import { createLtx23VideoWorkflow } from "./ltx-2-3-video";

const s3: S3StorageConfig = {
	accessKeyId: "access",
	bucket: "assets",
	endpoint: "https://s3.example.com",
	publicBaseUrl: "https://assets.example.com",
	region: "hel1",
	secretAccessKey: "secret",
};

const baseCtx: PodRuntimeContext = {
	logPublicUrl: "https://assets.example.com/log.txt",
	logUploadUrl: "https://uploads.example.com/log",
	outputContentType: "video/mp4",
	outputPublicUrl: "https://assets.example.com/output.mp4",
	outputUploadUrl: "https://uploads.example.com/output",
	requestId: "req-1",
	s3,
	timeoutMs: undefined,
};

describe("ltx-2-3-video workflow", () => {
	const workflow = createLtx23VideoWorkflow({
		hfToken: "hf-token",
		pod: {
			bootstrapUrl: "https://cdn.example.com/runpod-ltx23/pod-bootstrap.sh",
			gpuTypeIds: ["NVIDIA RTX A6000"],
			imageName: "ls250824/run-comfyui-ltx:test",
		},
	});

	it("produces canonical env keys consumed by pod_runner.py", () => {
		const parsed = workflow.inputSchema.parse({ prompt: "test prompt" });
		const env = workflow.buildEnv(parsed, baseCtx);

		expect(env).toMatchObject({
			CFG_SCALE: "1",
			FPS: "24",
			HEIGHT: "1280",
			HF_TOKEN: "hf-token",
			NUM_FRAMES: "241",
			OUTPUT_CONTENT_TYPE: "video/mp4",
			OUTPUT_UPLOAD_URL: "https://uploads.example.com/output",
			LOG_UPLOAD_URL: "https://uploads.example.com/log",
			POD_RUNNER_URL: "https://cdn.example.com/runpod-ltx23/pod_runner.py",
			PROMPT: "test prompt",
			RUNPOD_JOB_ID: "req-1",
			STEPS: "8",
			WIDTH: "896",
			WORKFLOW_URL:
				"https://raw.githubusercontent.com/Lightricks/ComfyUI-LTXVideo/master/example_workflows/2.3/LTX-2.3_T2V_I2V_Single_Stage_Distilled_Full.json",
		});
		expect(env.LORA_URL).toBe("");
		expect(env.SEED).toBeUndefined();
		expect(env.INPUT_IMAGE_URL).toBeUndefined();
	});

	it("threads optional inputs (seed, image, lora, civitai) into env", () => {
		const wf = createLtx23VideoWorkflow({
			civitaiApiKey: "civitai-key",
			pod: {
				bootstrapUrl: "https://cdn.example.com/pod-bootstrap.sh",
				gpuTypeIds: ["A6000"],
				imageName: "img:latest",
				timeoutMs: 35 * 60 * 1000,
			},
		});

		const parsed = wf.inputSchema.parse({
			prompt: "test",
			seed: 42,
			inputImageUrl: "https://example.com/in.png",
			loraUrl: "https://example.com/lora.safetensors",
		});
		const env = wf.buildEnv(parsed, { ...baseCtx, timeoutMs: 35 * 60 * 1000 });

		expect(env.SEED).toBe("42");
		expect(env.INPUT_IMAGE_URL).toBe("https://example.com/in.png");
		expect(env.LORA_URL).toBe("https://example.com/lora.safetensors");
		expect(env.CIVITAI_API_KEY).toBe("civitai-key");
		expect(env.RUNPOD_POD_TIMEOUT_SECONDS).toBe("2100");
	});

	it("returns shape consumed by generator with public URLs and pod info", () => {
		const output = workflow.parseOutput({
			logPublicUrl: baseCtx.logPublicUrl,
			outputPublicUrl: baseCtx.outputPublicUrl,
			outputStat: {
				etag: "etag",
				key: "k",
				lastModified: new Date(),
				sizeBytes: 1234,
				type: "video/mp4",
				url: baseCtx.outputPublicUrl,
			},
			podId: "pod-7",
			requestId: "req-1",
			runpodPodConsoleUrl: "https://runpod.io/console/pods/pod-7",
		});
		expect(output).toEqual({
			logUrl: baseCtx.logPublicUrl,
			podConsoleUrl: "https://runpod.io/console/pods/pod-7",
			podId: "pod-7",
			requestId: "req-1",
			videoUrl: baseCtx.outputPublicUrl,
		});
	});
});
