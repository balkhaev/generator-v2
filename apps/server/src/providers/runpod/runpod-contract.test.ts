import { describe, expect, test } from "bun:test";

import {
	createRunpodDispatchPayload,
	normalizeRunpodSubmitResponse,
	normalizeRunpodTerminalResult,
} from "./runpod-contract";

describe("Runpod contract helpers", () => {
	test("builds the dispatch payload expected by the MVP workflow adapter", () => {
		expect(
			createRunpodDispatchPayload({
				workflowKey: "ltx-2.3 i2v",
				prompt: "Animate the still image with a gentle dolly-in.",
				inputAssetUrl: "https://assets.internal.example/input-a.png",
				params: {
					seed: 12,
					guidanceScale: 4.2,
				},
			}),
		).toEqual({
			input: {
				workflowKey: "ltx-2.3 i2v",
				prompt: "Animate the still image with a gentle dolly-in.",
				inputAssetUrl: "https://assets.internal.example/input-a.png",
				params: {
					seed: 12,
					guidanceScale: 4.2,
				},
			},
		});
	});

	test("normalizes Runpod submission shapes to job ids and internal statuses", () => {
		expect(normalizeRunpodSubmitResponse({ id: "job_123", status: "queued" })).toEqual({
			jobId: "job_123",
			status: "queued",
		});
		expect(normalizeRunpodSubmitResponse({ jobId: "job_456", state: "running" })).toEqual({
			jobId: "job_456",
			status: "running",
		});
	});

	test("normalizes terminal success and failure payloads", () => {
		expect(
			normalizeRunpodTerminalResult({
				id: "job_success",
				status: "completed",
				output: {
					artifacts: [
						{
							kind: "video",
							url: "https://assets.internal.example/output-a.mp4",
							fileName: "output-a.mp4",
						},
					],
				},
			}),
		).toEqual({
			jobId: "job_success",
			status: "succeeded",
			artifacts: [
				{
					kind: "video",
					url: "https://assets.internal.example/output-a.mp4",
					fileName: "output-a.mp4",
				},
			],
		});
		expect(
			normalizeRunpodTerminalResult({
				jobId: "job_failed",
				state: "failed",
				error: {
					message: "Runpod job timed out",
					code: "TIMEOUT",
				},
			}),
		).toEqual({
			jobId: "job_failed",
			status: "failed",
			errorSummary: "Runpod job timed out",
			errorCode: "TIMEOUT",
		});
	});
});
