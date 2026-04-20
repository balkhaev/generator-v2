import { describe, expect, test } from "bun:test";

import { PersonLoraTrainingControlService } from "@/domain/person-lora-training-control";
import type {
	PersonLoraTrainingJobData,
	PersonLoraTrainingQueue,
} from "@/queue/person-lora-training";

describe("PersonLoraTrainingControlService", () => {
	test("preserves approval-flow fields when enqueuing a training run", async () => {
		let captured: PersonLoraTrainingJobData | null = null;
		const queue: PersonLoraTrainingQueue = {
			close: () => Promise.resolve(),
			enqueue: (input) => {
				captured = input;
				return Promise.resolve("training-job-1");
			},
			enqueueConfirmation: () => {
				return Promise.reject(new Error("unexpected confirmation enqueue"));
			},
			enqueueRefill: () => {
				return Promise.reject(new Error("unexpected refill enqueue"));
			},
		};

		const service = new PersonLoraTrainingControlService(queue);
		await service.enqueue({
			mode: "prep-only",
			personId: "person-1",
			personName: "Person",
			personSlug: "person",
			referencePhotoUrl: "https://assets.example.com/reference.png",
			seedReferenceImages: [
				{
					caption: "front portrait",
					s3Key: "datasets/person/front.png",
					url: "https://assets.example.com/front.png",
					variantId: "variant-1",
				},
			],
			trainingRunId: "training-run-1",
		});

		expect(captured).toMatchObject({
			mode: "prep-only",
			seedReferenceImages: [
				{
					caption: "front portrait",
					s3Key: "datasets/person/front.png",
					url: "https://assets.example.com/front.png",
					variantId: "variant-1",
				},
			],
		});
	});
});
