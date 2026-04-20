import { z } from "zod";

import type { PersonLoraTrainingQueue } from "@/queue/person-lora-training";

export const enqueuePersonLoraTrainingSchema = z.object({
	debugCorrelationId: z.string().trim().min(1).optional(),
	description: z.string().trim().optional(),
	mode: z.enum(["prep-only", "auto-train"]).optional(),
	outputName: z.string().trim().min(1).optional(),
	personId: z.string().trim().min(1),
	personName: z.string().trim().min(1),
	personSlug: z.string().trim().min(1),
	referencePhotoUrl: z.url(),
	referencePrompt: z.string().trim().min(1).optional(),
	reuseDatasetUrl: z.url().optional(),
	seedReferenceImages: z
		.array(
			z.object({
				caption: z.string(),
				s3Key: z.string().nullable().optional(),
				url: z.url(),
				variantId: z.string().trim().min(1),
			})
		)
		.optional(),
	trainingRunId: z.string().trim().min(1),
	triggerWord: z.string().trim().min(1).optional(),
});

export interface PersonLoraTrainingControl {
	enqueue: (
		input: z.input<typeof enqueuePersonLoraTrainingSchema>
	) => Promise<{ accepted: true; jobId: string }>;
}

export class PersonLoraTrainingControlService {
	private readonly queue: PersonLoraTrainingQueue;

	constructor(queue: PersonLoraTrainingQueue) {
		this.queue = queue;
	}

	async enqueue(input: z.input<typeof enqueuePersonLoraTrainingSchema>) {
		const parsed = enqueuePersonLoraTrainingSchema.parse(input);
		const jobId = await this.queue.enqueue(parsed);
		return {
			accepted: true as const,
			jobId,
		};
	}
}
