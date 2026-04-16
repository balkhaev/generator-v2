import type { GeneratorExecutionRecord } from "@generator/contracts/generator";
import { env } from "@generator/env/server";
import type { GeneratorExecutionClient } from "@generator/generator-client-server";
import { z } from "zod";
import type { AdminTrainingClient } from "@/clients/admin-training";

const optionalStringSchema = z.preprocess((value) => {
	if (typeof value !== "string") {
		return value;
	}

	const trimmedValue = value.trim();
	return trimmedValue.length > 0 ? trimmedValue : undefined;
}, z.string().optional());

const optionalUrlSchema = z.preprocess((value) => {
	if (typeof value !== "string") {
		return value;
	}

	const trimmedValue = value.trim();
	return trimmedValue.length > 0 ? trimmedValue : undefined;
}, z.url().optional());

const optionalNumberSchema = z.preprocess((value) => {
	if (value === null || value === undefined) {
		return undefined;
	}

	return value;
}, z.number().finite().optional());

export const personGenerationMediaTypeSchema = z.enum([
	"image",
	"video",
	"audio",
]);
export type PersonGenerationMediaType = z.infer<
	typeof personGenerationMediaTypeSchema
>;

export const personGenerationStatusSchema = z.enum([
	"ready",
	"queued",
	"failed",
]);
export type PersonGenerationStatus = z.infer<
	typeof personGenerationStatusSchema
>;

export const personGenerationMetadataSchema = z
	.record(z.string(), z.unknown())
	.default({});

export const createPersonGenerationInputSchema = z.object({
	title: z.string().trim().min(1, "Generation title is required"),
	prompt: z.string().trim().default(""),
	mediaType: personGenerationMediaTypeSchema,
	status: personGenerationStatusSchema.default("ready"),
	previewUrl: optionalUrlSchema,
	sourceUrl: z.url("Generation source URL must be valid"),
	operatorRunId: optionalStringSchema,
	operatorScenarioId: optionalStringSchema,
	errorSummary: optionalStringSchema,
	metadata: personGenerationMetadataSchema,
});

export const createPersonInputSchema = z
	.object({
		name: z.string().trim().min(1, "Person name is required"),
		slug: optionalStringSchema,
		description: z.string().trim().default(""),
		referencePhotoUrl: optionalUrlSchema,
		datasetUrl: optionalUrlSchema,
		loraUrl: optionalUrlSchema,
		photoUrl: optionalUrlSchema,
		videoUrl: optionalUrlSchema,
		voiceWavUrl: optionalUrlSchema,
		metadata: z.record(z.string(), z.unknown()).default({}),
		generations: z.array(createPersonGenerationInputSchema).default([]),
	})
	.refine(
		(v) =>
			(v.referencePhotoUrl && v.referencePhotoUrl.length > 0) ||
			(v.description && v.description.length > 0),
		{ message: "Either a reference photo URL or a description is required" }
	);

export const updatePersonInputSchema = z
	.object({
		name: z.string().trim().min(1).optional(),
		slug: optionalStringSchema,
		description: z.string().trim().optional(),
		referencePhotoUrl: z.url().optional(),
		datasetUrl: optionalUrlSchema,
		loraUrl: optionalUrlSchema,
		photoUrl: optionalUrlSchema,
		videoUrl: optionalUrlSchema,
		voiceWavUrl: optionalUrlSchema,
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "At least one field must be provided",
	});

export const importServerGenerationInputSchema = z.object({
	providerEndpointId: optionalStringSchema,
	providerJobId: z.string().trim().min(1, "Execution job id is required"),
	prompt: z.string().trim().optional(),
	title: optionalStringSchema,
	workflowKey: z.string().trim().min(1, "Workflow key is required"),
});
export const createPersonFromPromptInputSchema = z.object({
	name: z.string().trim().min(1, "Person name is required"),
	slug: optionalStringSchema,
	description: z.string().trim().default(""),
	prompt: z.string().trim().min(1, "Avatar prompt is required"),
	datasetUrl: optionalUrlSchema,
	loraUrl: optionalUrlSchema,
	photoUrl: optionalUrlSchema,
	videoUrl: optionalUrlSchema,
	voiceWavUrl: optionalUrlSchema,
	metadata: z.record(z.string(), z.unknown()).default({}),
});

export const startPersonLoraTrainingInputSchema = z.object({
	outputName: optionalStringSchema,
	referencePrompt: optionalStringSchema,
	triggerWord: optionalStringSchema,
});

const personLoraTrainingStatusSchema = z.enum([
	"queued",
	"generating",
	"training",
	"publishing",
	"ready",
	"failed",
]);

const personLoraTrainingEventSchema = z.object({
	assetReleaseId: optionalStringSchema,
	completedAt: optionalStringSchema,
	datasetUrl: optionalUrlSchema,
	datasetZipSizeBytes: optionalNumberSchema,
	debug: z.record(z.string(), z.unknown()).optional(),
	debugCorrelationId: optionalStringSchema,
	errorSummary: optionalStringSchema,
	failedAt: optionalStringSchema,
	lastEventAt: optionalStringSchema,
	loraUrl: optionalUrlSchema,
	phase: optionalStringSchema,
	progressPct: optionalNumberSchema,
	provider: optionalStringSchema,
	providerJobId: optionalStringSchema,
	providerRequestId: optionalStringSchema,
	providerStatus: optionalStringSchema,
	referenceImageCount: optionalNumberSchema,
	referenceImageTargetCount: optionalNumberSchema,
	referenceImageUrls: z.array(z.url()).optional(),
	status: personLoraTrainingStatusSchema,
	trainingElapsedMs: optionalNumberSchema,
	trainingRunId: optionalStringSchema,
	trainingStartedAt: optionalStringSchema,
	trainingSteps: optionalNumberSchema,
	triggerWord: optionalStringSchema,
	uploadMethod: optionalStringSchema,
});

export interface PersonGenerationRecord {
	createdAt: Date;
	errorSummary: string | null;
	id: string;
	mediaType: PersonGenerationMediaType;
	metadata: Record<string, unknown>;
	operatorRunId: string | null;
	operatorScenarioId: string | null;
	personId: string;
	previewUrl: string | null;
	prompt: string;
	sourceUrl: string;
	status: PersonGenerationStatus;
	title: string;
	updatedAt: Date;
}

export interface PersonRecord {
	createdAt: Date;
	datasetUrl: string | null;
	description: string;
	generations: PersonGenerationRecord[];
	id: string;
	loraUrl: string | null;
	metadata: Record<string, unknown>;
	name: string;
	photoUrl: string | null;
	referencePhotoUrl: string;
	slug: string;
	updatedAt: Date;
	videoUrl: string | null;
	voiceWavUrl: string | null;
}

export interface PersonsRepository {
	createGeneration(
		input: Omit<PersonGenerationRecord, "createdAt" | "updatedAt">
	): Promise<PersonGenerationRecord>;
	createPerson(input: {
		generations: Omit<PersonGenerationRecord, "createdAt" | "updatedAt">[];
		person: Omit<PersonRecord, "createdAt" | "updatedAt" | "generations">;
	}): Promise<PersonRecord>;
	deleteDatasetGenerations(
		personId: string,
		keepSourceUrls: string[]
	): Promise<number>;
	deleteGeneration(
		personId: string,
		generationId: string
	): Promise<PersonGenerationRecord | null>;
	deletePerson(personId: string): Promise<boolean>;
	findPersonByOperatorRunId(
		operatorRunId: string
	): Promise<PersonRecord | null>;
	getGenerationByOperatorRunId(
		operatorRunId: string
	): Promise<PersonGenerationRecord | null>;
	getPersonById(personId: string): Promise<PersonRecord | null>;
	getPersonBySlug(slug: string): Promise<PersonRecord | null>;
	listPersons(): Promise<PersonRecord[]>;
	listQueuedGenerations(limit: number): Promise<PersonGenerationRecord[]>;
	updateGeneration(
		generationId: string,
		input: Partial<
			Omit<
				PersonGenerationRecord,
				"createdAt" | "updatedAt" | "id" | "personId"
			>
		>
	): Promise<PersonGenerationRecord | null>;
	updatePerson(
		personId: string,
		input: Partial<
			Omit<PersonRecord, "createdAt" | "updatedAt" | "generations">
		>
	): Promise<PersonRecord | null>;
}

/**
 * Канонический клиент `generator-api`, используемый persons-сервисом.
 * На текущем этапе persons обращается только к executions + health,
 * поэтому алиасим общий `GeneratorExecutionClient` из
 * `@generator/generator-client-server` без дополнительных методов.
 */
export type OperatorServerClient = GeneratorExecutionClient;

const FEMALE_HINT_PATTERN =
	/\b(woman|girl|female|женщина|девушка|девочка|she|her)\b/i;
const MALE_HINT_PATTERN = /\b(man|boy|male|мужчина|парень|мальчик|he|his)\b/i;

function inferGenderHint(description: string): string | null {
	if (FEMALE_HINT_PATTERN.test(description)) {
		return "woman";
	}
	if (MALE_HINT_PATTERN.test(description)) {
		return "man";
	}
	return null;
}

function extractLoraTrainingMeta(metadata: Record<string, unknown>) {
	const training =
		metadata.training &&
		typeof metadata.training === "object" &&
		!Array.isArray(metadata.training)
			? (metadata.training as Record<string, unknown>)
			: {};
	const debug =
		training.debug &&
		typeof training.debug === "object" &&
		!Array.isArray(training.debug)
			? (training.debug as Record<string, unknown>)
			: {};
	return { training, debug };
}

function slugifySegment(value: string) {
	return value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^\p{Letter}\p{Number}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
}

const imageMediaUrlPattern = /\.(png|jpe?g|webp|gif)(\?.*)?$/;
const audioMediaUrlPattern = /\.(wav|mp3|ogg|m4a)(\?.*)?$/;

function inferMediaTypeFromUrl(url: string): PersonGenerationMediaType {
	const normalizedUrl = url.toLowerCase();

	if (imageMediaUrlPattern.test(normalizedUrl)) {
		return "image";
	}

	if (audioMediaUrlPattern.test(normalizedUrl)) {
		return "audio";
	}

	return "video";
}

function createPendingReferenceDataUrl(name: string) {
	const label = encodeURIComponent(name.slice(0, 48));
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 1024"><rect width="768" height="1024" fill="#e8dfd1"/><rect x="48" y="48" width="672" height="928" fill="#1b1816"/><text x="384" y="470" font-size="56" text-anchor="middle" fill="#f4ead8" font-family="Arial, sans-serif">Generating</text><text x="384" y="548" font-size="36" text-anchor="middle" fill="#cdbd9e" font-family="Arial, sans-serif">${label}</text></svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createPendingGenerationDataUrl(label: string) {
	const encoded = encodeURIComponent(label.slice(0, 48));
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 1024"><rect width="768" height="1024" fill="#1b1816"/><text x="384" y="490" font-size="48" text-anchor="middle" fill="#f4ead8" font-family="Arial, sans-serif">⏳</text><text x="384" y="550" font-size="28" text-anchor="middle" fill="#cdbd9e" font-family="Arial, sans-serif">${encoded}</text></svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function readMetadataNumber(
	record: Record<string, unknown>,
	key: string
): number | null {
	const value = record[key];
	return typeof value === "number" ? value : null;
}

function readMetadataString(
	record: Record<string, unknown>,
	key: string
): string | null {
	const value = record[key];
	return typeof value === "string" ? value : null;
}

function clampProgressPct(value: number) {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function getExecutionProgressPct(execution: GeneratorExecutionRecord) {
	if (typeof execution.progressPct === "number") {
		return clampProgressPct(execution.progressPct);
	}

	switch (execution.status) {
		case "queued":
			return 5;
		case "running":
			return 65;
		case "succeeded":
		case "failed":
			return 100;
		default:
			return 0;
	}
}

function getGenerationProgressMetadata(input: {
	execution?: GeneratorExecutionRecord;
	metadata: Record<string, unknown>;
}) {
	const progressPct = input.execution
		? getExecutionProgressPct(input.execution)
		: 2;

	return {
		...input.metadata,
		generatorStatus: input.execution?.status ?? "queued",
		progressPct,
	};
}

function hasProgressMetadataChanged(
	metadata: Record<string, unknown>,
	execution: GeneratorExecutionRecord
) {
	return (
		readMetadataNumber(metadata, "progressPct") !==
			getExecutionProgressPct(execution) ||
		readMetadataString(metadata, "generatorStatus") !== execution.status
	);
}

export class PersonsService {
	private readonly repository: PersonsRepository;
	private readonly operatorServerClient?: OperatorServerClient;
	private readonly callbackConfig?: { token: string; url: string };
	private readonly adminTrainingClient?: AdminTrainingClient;

	constructor(
		repository: PersonsRepository,
		operatorServerClient?: OperatorServerClient,
		callbackConfig?: { token: string; url: string },
		adminTrainingClient?: AdminTrainingClient
	) {
		this.repository = repository;
		this.operatorServerClient = operatorServerClient;
		this.callbackConfig = callbackConfig;
		this.adminTrainingClient = adminTrainingClient;
	}

	listPersons() {
		return this.repository.listPersons();
	}

	getPersonById(personId: string) {
		return this.repository.getPersonById(personId);
	}

	findPersonByOperatorRunId(operatorRunId: string) {
		return this.repository.findPersonByOperatorRunId(operatorRunId);
	}

	createPerson(input: z.input<typeof createPersonInputSchema>) {
		const parsed = createPersonInputSchema.parse(input);

		if (!parsed.referencePhotoUrl) {
			return this.createPersonFromPrompt({
				name: parsed.name,
				slug: parsed.slug,
				description: parsed.description,
				prompt: parsed.description,
				datasetUrl: parsed.datasetUrl,
				loraUrl: parsed.loraUrl,
				photoUrl: parsed.photoUrl,
				videoUrl: parsed.videoUrl,
				voiceWavUrl: parsed.voiceWavUrl,
				metadata: parsed.metadata,
			});
		}

		return this.createPersonRecord({
			datasetUrl: parsed.datasetUrl ?? null,
			description: parsed.description,
			generations: parsed.generations.map((generation) => ({
				errorSummary: generation.errorSummary ?? null,
				id: crypto.randomUUID(),
				mediaType: generation.mediaType,
				metadata: generation.metadata,
				operatorRunId: generation.operatorRunId ?? null,
				operatorScenarioId: generation.operatorScenarioId ?? null,
				personId: "",
				previewUrl: generation.previewUrl ?? null,
				prompt: generation.prompt,
				sourceUrl: generation.sourceUrl,
				status: generation.status,
				title: generation.title,
			})),
			loraUrl: parsed.loraUrl ?? null,
			metadata: parsed.metadata,
			name: parsed.name,
			photoUrl: parsed.photoUrl ?? null,
			referencePhotoUrl: parsed.referencePhotoUrl,
			slug: parsed.slug,
			videoUrl: parsed.videoUrl ?? null,
			voiceWavUrl: parsed.voiceWavUrl ?? null,
		});
	}

	async createPersonFromPrompt(
		input: z.input<typeof createPersonFromPromptInputSchema>
	) {
		const parsed = createPersonFromPromptInputSchema.parse(input);
		if (!this.operatorServerClient) {
			throw new Error("Generator integration is not configured");
		}

		const avatarWorkflow = env.PERSONS_DEFAULT_AVATAR_WORKFLOW;
		const defaultParams = {
			imageSize: "portrait_4_3",
			numInferenceSteps: 8,
			numImages: 1,
			enableSafetyChecker: false,
			outputFormat: "png",
		};

		const placeholderReferencePhotoUrl = createPendingReferenceDataUrl(
			parsed.name
		);
		const createdPerson = await this.createPersonRecord({
			datasetUrl: parsed.datasetUrl ?? null,
			description: parsed.description,
			generations: [
				{
					errorSummary: null,
					id: crypto.randomUUID(),
					mediaType: "image",
					metadata: getGenerationProgressMetadata({
						metadata: {
							generatedFromPrompt: true,
							workflowKey: avatarWorkflow,
						},
					}),
					operatorRunId: null,
					operatorScenarioId: null,
					personId: "",
					previewUrl: placeholderReferencePhotoUrl,
					prompt: parsed.prompt,
					sourceUrl: placeholderReferencePhotoUrl,
					status: "queued",
					title: "Generating avatar",
				},
			],
			loraUrl: parsed.loraUrl ?? null,
			metadata: {
				...parsed.metadata,
				autoStartTraining: true,
			},
			name: parsed.name,
			photoUrl: parsed.photoUrl ?? placeholderReferencePhotoUrl,
			referencePhotoUrl: placeholderReferencePhotoUrl,
			slug: parsed.slug,
			videoUrl: parsed.videoUrl ?? null,
			voiceWavUrl: parsed.voiceWavUrl ?? null,
		});

		const queuedGeneration = createdPerson.generations[0];
		if (!queuedGeneration) {
			throw new Error("Prompt generation was not created");
		}

		const execution = await this.operatorServerClient.createExecution({
			callback: this.callbackConfig
				? {
						context: {
							generationId: queuedGeneration.id,
							personId: createdPerson.id,
						},
						token: this.callbackConfig.token,
						url: this.callbackConfig.url,
					}
				: undefined,
			workflowKey: avatarWorkflow,
			prompt: parsed.prompt,
			params: defaultParams,
		});
		await this.repository.updateGeneration(queuedGeneration.id, {
			metadata: getGenerationProgressMetadata({
				execution,
				metadata: {
					...queuedGeneration.metadata,
					generatorExecutionId: execution.id,
					generatorWorkflowKey: execution.workflowKey,
				},
			}),
			operatorRunId: execution.providerJobId,
			status: execution.status === "failed" ? "failed" : "queued",
		});

		return (
			(await this.repository.getPersonById(createdPerson.id)) ?? createdPerson
		);
	}

	private async createPersonRecord(input: {
		datasetUrl: string | null;
		description: string;
		generations: Omit<PersonGenerationRecord, "createdAt" | "updatedAt">[];
		loraUrl: string | null;
		metadata: Record<string, unknown>;
		name: string;
		photoUrl: string | null;
		referencePhotoUrl: string;
		slug?: string;
		videoUrl: string | null;
		voiceWavUrl: string | null;
	}) {
		const baseSlug = slugifySegment(input.slug ?? input.name);
		const uniqueSlug =
			baseSlug.length > 0
				? await this.ensureUniqueSlug(baseSlug)
				: crypto.randomUUID();

		return this.repository.createPerson({
			person: {
				id: crypto.randomUUID(),
				name: input.name,
				slug: uniqueSlug,
				description: input.description,
				referencePhotoUrl: input.referencePhotoUrl,
				datasetUrl: input.datasetUrl,
				loraUrl: input.loraUrl,
				photoUrl: input.photoUrl,
				videoUrl: input.videoUrl,
				voiceWavUrl: input.voiceWavUrl,
				metadata: input.metadata,
			},
			generations: input.generations,
		});
	}

	async updatePerson(
		personId: string,
		input: z.input<typeof updatePersonInputSchema>
	) {
		const parsed = updatePersonInputSchema.parse(input);
		const current = await this.repository.getPersonById(personId);

		if (!current) {
			return null;
		}

		let nextSlug = parsed.slug;

		if (typeof parsed.name === "string" && !nextSlug) {
			const candidateSlug = slugifySegment(parsed.name);
			if (candidateSlug.length > 0 && candidateSlug !== current.slug) {
				nextSlug = await this.ensureUniqueSlug(candidateSlug, personId);
			}
		}

		if (typeof parsed.slug === "string") {
			const candidateSlug = slugifySegment(parsed.slug);
			nextSlug =
				candidateSlug.length > 0
					? await this.ensureUniqueSlug(candidateSlug, personId)
					: current.slug;
		}

		return this.repository.updatePerson(personId, {
			...parsed,
			slug: nextSlug,
			datasetUrl: parsed.datasetUrl ?? current.datasetUrl,
			loraUrl: parsed.loraUrl ?? current.loraUrl,
			photoUrl: parsed.photoUrl ?? current.photoUrl,
			videoUrl: parsed.videoUrl ?? current.videoUrl,
			voiceWavUrl: parsed.voiceWavUrl ?? current.voiceWavUrl,
		});
	}

	deletePerson(personId: string) {
		return this.repository.deletePerson(personId);
	}

	async deleteGeneration(personId: string, generationId: string) {
		const person = await this.repository.getPersonById(personId);

		if (!person) {
			return null;
		}

		const generation = person.generations.find(
			(item) => item.id === generationId
		);
		if (!generation) {
			return null;
		}

		const deletedGeneration = await this.repository.deleteGeneration(
			personId,
			generationId
		);
		if (!deletedGeneration) {
			return null;
		}

		if (deletedGeneration.metadata.isDatasetPhoto !== true) {
			return this.repository.getPersonById(personId);
		}

		const training =
			person.metadata.training &&
			typeof person.metadata.training === "object" &&
			!Array.isArray(person.metadata.training)
				? (person.metadata.training as Record<string, unknown>)
				: null;
		if (!training) {
			return this.repository.getPersonById(personId);
		}

		const nextReferenceImageUrls = Array.isArray(training.referenceImageUrls)
			? training.referenceImageUrls.filter(
					(value): value is string =>
						typeof value === "string" && value !== deletedGeneration.sourceUrl
				)
			: [];

		await this.repository.updatePerson(personId, {
			metadata: {
				...person.metadata,
				training: {
					...training,
					referenceImageCount: nextReferenceImageUrls.length,
					referenceImageUrls: nextReferenceImageUrls,
				},
			},
		});

		return this.repository.getPersonById(personId);
	}

	async createGeneration(
		personId: string,
		input: z.input<typeof createPersonGenerationInputSchema>
	) {
		const parsed = createPersonGenerationInputSchema.parse(input);
		const person = await this.repository.getPersonById(personId);

		if (!person) {
			return null;
		}

		return this.repository.createGeneration({
			id: crypto.randomUUID(),
			personId,
			title: parsed.title,
			prompt: parsed.prompt,
			mediaType: parsed.mediaType,
			status: parsed.status,
			previewUrl: parsed.previewUrl ?? null,
			sourceUrl: parsed.sourceUrl,
			operatorRunId: parsed.operatorRunId ?? null,
			operatorScenarioId: parsed.operatorScenarioId ?? null,
			errorSummary: parsed.errorSummary ?? null,
			metadata: parsed.metadata,
		});
	}

	async startLoraTraining(
		personId: string,
		input: z.input<typeof startPersonLoraTrainingInputSchema>,
		options?: {
			debugCorrelationId?: string;
		}
	) {
		const parsed = startPersonLoraTrainingInputSchema.parse(input);
		const person = await this.repository.getPersonById(personId);

		if (!person) {
			return null;
		}
		if (!this.adminTrainingClient) {
			throw new Error("Admin training integration is not configured");
		}

		if (person.loraUrl) {
			return person;
		}

		const currentTrainingObj =
			person.metadata.training &&
			typeof person.metadata.training === "object" &&
			!Array.isArray(person.metadata.training)
				? (person.metadata.training as Record<string, unknown>)
				: null;
		const currentTrainingStatus = currentTrainingObj?.status;
		if (
			currentTrainingStatus === "queued" ||
			currentTrainingStatus === "generating" ||
			currentTrainingStatus === "training" ||
			currentTrainingStatus === "publishing"
		) {
			return person;
		}

		const fallbackTriggerWord =
			person.slug.replace(/-/g, "_").slice(0, 48) ||
			person.id.replace(/-/g, "_");
		const triggerWord = parsed.triggerWord ?? fallbackTriggerWord;
		const trainingRunId = crypto.randomUUID();
		const outputName =
			parsed.outputName ??
			`${person.slug}-sdxl-lora-${new Date().toISOString().slice(0, 10)}`;
		const requestedAt = new Date().toISOString();
		const trainingMetadata = {
			assetReleaseId: null,
			completedAt: null,
			datasetUrl: person.datasetUrl,
			datasetZipSizeBytes: null,
			debug: {
				sourceReferencePhotoUrl: person.referencePhotoUrl,
			},
			debugCorrelationId: options?.debugCorrelationId ?? null,
			errorSummary: null,
			failedAt: null,
			history: [
				{
					at: requestedAt,
					errorSummary: null,
					phase: "queued",
					progressPct: 2,
					providerJobId: null,
					providerRequestId: null,
					providerStatus: null,
					referenceImageCount: 0,
					status: "queued",
				},
			],
			lastEventAt: requestedAt,
			loraUrl: person.loraUrl,
			outputName,
			phase: "queued",
			progressPct: 2,
			provider: null,
			providerJobId: null,
			providerRequestId: null,
			providerStatus: null,
			referenceImageCount: 0,
			referenceImageTargetCount: null,
			referenceImageUrls: [],
			referencePrompt: parsed.referencePrompt ?? null,
			requestedAt,
			startedAt: requestedAt,
			status: "queued",
			trainingElapsedMs: null,
			trainingRunId,
			trainingStartedAt: null,
			trainingSteps: null,
			triggerWord,
			updatedAt: requestedAt,
			uploadMethod: null,
		} satisfies Record<string, unknown>;

		const updatedPerson = await this.repository.updatePerson(personId, {
			metadata: {
				...person.metadata,
				training: trainingMetadata,
			},
		});

		await this.adminTrainingClient.startPersonLoraTraining(
			{
				debugCorrelationId: options?.debugCorrelationId,
				description: person.description,
				outputName,
				personId: person.id,
				personName: person.name,
				personSlug: person.slug,
				referencePhotoUrl: person.referencePhotoUrl,
				referencePrompt: parsed.referencePrompt ?? undefined,
				trainingRunId,
				triggerWord,
			},
			{
				debugCorrelationId: options?.debugCorrelationId,
			}
		);

		return updatedPerson ?? person;
	}

	async generateWithLora(
		personId: string,
		userPrompt: string,
		options?: {
			extraLoraUrl?: string;
			extraLoraWeight?: number;
		}
	) {
		const person = await this.repository.getPersonById(personId);
		if (!person) {
			return null;
		}
		if (!person.loraUrl) {
			throw new Error("Person does not have a trained LoRA");
		}
		if (!this.operatorServerClient) {
			throw new Error("Generator integration is not configured");
		}

		const { training, debug: trainingDebug } = extractLoraTrainingMeta(
			person.metadata
		);
		const triggerWord =
			typeof training.triggerWord === "string"
				? training.triggerWord
				: person.slug.replace(/-/g, "_");
		const genderHint =
			typeof trainingDebug.genderHint === "string"
				? trainingDebug.genderHint
				: inferGenderHint(person.description);

		const prompt = [
			genderHint
				? `a photo of ${triggerWord} ${genderHint}`
				: `a photo of ${triggerWord}`,
			userPrompt,
		]
			.filter((part): part is string => Boolean(part))
			.join(", ");
		let resolvedExtraLoraUrl = options?.extraLoraUrl;
		if (resolvedExtraLoraUrl && this.adminTrainingClient) {
			try {
				resolvedExtraLoraUrl =
					await this.adminTrainingClient.cacheExternalLora(
						resolvedExtraLoraUrl
					);
			} catch {
				// fall through with original URL if caching fails
			}
		}

		const workflowKey = env.PERSONS_DEFAULT_LORA_WORKFLOW;
		const isImageToImageWorkflow = workflowKey.includes("image-to-image");
		const loraParams = {
			enableSafetyChecker: false,
			extraLoraUrl: resolvedExtraLoraUrl,
			extraLoraWeight: options?.extraLoraWeight ?? 0.05,
			imageSize: "portrait_4_3",
			loraUrl: person.loraUrl,
			loraWeight: 1.0,
			numImages: 1,
			numInferenceSteps: isImageToImageWorkflow ? 8 : 12,
			outputFormat: "png",
			...(isImageToImageWorkflow ? { strength: 0.95 } : {}),
		};

		const generationId = crypto.randomUUID();
		await this.repository.createGeneration({
			id: generationId,
			personId,
			title: "Generating with LoRA",
			prompt,
			mediaType: "image",
			status: "queued",
			previewUrl: null,
			sourceUrl: createPendingGenerationDataUrl("LoRA generation"),
			operatorRunId: null,
			operatorScenarioId: null,
			errorSummary: null,
			metadata: getGenerationProgressMetadata({
				metadata: { workflowKey, generatedWithLora: true },
			}),
		});

		const execution = await this.operatorServerClient.createExecution({
			callback: this.callbackConfig
				? {
						context: { generationId, personId },
						token: this.callbackConfig.token,
						url: this.callbackConfig.url,
					}
				: undefined,
			inputImageUrl: isImageToImageWorkflow
				? person.referencePhotoUrl
				: undefined,
			workflowKey,
			prompt,
			params: loraParams,
		});

		await this.repository.updateGeneration(generationId, {
			metadata: getGenerationProgressMetadata({
				execution,
				metadata: {
					workflowKey,
					generatedWithLora: true,
					...(options?.extraLoraUrl
						? {
								extraLoraUrl: options.extraLoraUrl,
								extraLoraWeight: options.extraLoraWeight ?? 0.05,
							}
						: {}),
					generatorExecutionId: execution.id,
					generatorWorkflowKey: execution.workflowKey,
				},
			}),
			operatorRunId: execution.providerJobId,
			status: execution.status === "failed" ? "failed" : "queued",
		});

		return this.repository.getPersonById(personId) ?? person;
	}

	async getServerHealth() {
		if (!this.operatorServerClient) {
			return {
				configured: false,
				status: "unavailable" as const,
				health: null,
			};
		}

		try {
			const health = await this.operatorServerClient.getHealth();
			return {
				configured: true,
				status: "connected" as const,
				health,
			};
		} catch (error) {
			return {
				configured: true,
				status: "error" as const,
				health: null,
				error:
					error instanceof Error
						? error.message
						: "Unable to reach the generator API",
			};
		}
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: training callback state machine
	async applyLoraTrainingEvent(input: {
		context: Record<string, unknown>;
		event: unknown;
	}) {
		const personId =
			typeof input.context.personId === "string"
				? input.context.personId
				: null;
		if (!personId) {
			throw new Error("Invalid persons training callback context");
		}

		const person = await this.repository.getPersonById(personId);
		if (!person) {
			return null;
		}

		const parsedEvent = personLoraTrainingEventSchema.parse(input.event);
		const currentTraining = (
			person.metadata.training &&
			typeof person.metadata.training === "object" &&
			!Array.isArray(person.metadata.training)
				? person.metadata.training
				: {}
		) as Record<string, unknown>;
		const now = new Date().toISOString();
		const currentTrainingRunId =
			typeof currentTraining.trainingRunId === "string"
				? currentTraining.trainingRunId
				: null;
		const callbackTrainingRunId =
			typeof parsedEvent.trainingRunId === "string"
				? parsedEvent.trainingRunId
				: null;
		if (
			currentTrainingRunId &&
			(callbackTrainingRunId === null ||
				callbackTrainingRunId !== currentTrainingRunId)
		) {
			return person;
		}
		const nextReferenceImageUrls =
			parsedEvent.referenceImageUrls ??
			(Array.isArray(currentTraining.referenceImageUrls)
				? currentTraining.referenceImageUrls.filter(
						(value): value is string => typeof value === "string"
					)
				: []);
		const currentDebug =
			currentTraining.debug &&
			typeof currentTraining.debug === "object" &&
			!Array.isArray(currentTraining.debug)
				? (currentTraining.debug as Record<string, unknown>)
				: {};
		const nextDebug =
			parsedEvent.debug &&
			typeof parsedEvent.debug === "object" &&
			!Array.isArray(parsedEvent.debug)
				? {
						...currentDebug,
						...parsedEvent.debug,
					}
				: currentDebug;
		const currentProgressPct = readMetadataNumber(
			currentTraining,
			"progressPct"
		);
		const nextProgressPct =
			typeof parsedEvent.progressPct === "number"
				? parsedEvent.progressPct
				: currentProgressPct;
		const nextPhase =
			parsedEvent.phase ?? readMetadataString(currentTraining, "phase");
		const nextProviderJobId =
			parsedEvent.providerJobId ??
			readMetadataString(currentTraining, "providerJobId");
		const nextProviderRequestId =
			parsedEvent.providerRequestId ??
			readMetadataString(currentTraining, "providerRequestId");
		const nextProviderStatus =
			parsedEvent.providerStatus ??
			readMetadataString(currentTraining, "providerStatus");
		const nextReferenceImageCount =
			typeof parsedEvent.referenceImageCount === "number"
				? parsedEvent.referenceImageCount
				: nextReferenceImageUrls.length;
		const currentHistory = Array.isArray(currentTraining.history)
			? currentTraining.history.filter(
					(entry): entry is Record<string, unknown> =>
						typeof entry === "object" && entry !== null && !Array.isArray(entry)
				)
			: [];
		const historyEntry = {
			at: parsedEvent.lastEventAt ?? now,
			errorSummary: parsedEvent.errorSummary ?? null,
			phase: nextPhase,
			progressPct: nextProgressPct,
			providerJobId: nextProviderJobId,
			providerRequestId: nextProviderRequestId,
			providerStatus: nextProviderStatus,
			referenceImageCount: nextReferenceImageCount,
			status: parsedEvent.status,
		};
		const nextHistory = [...currentHistory, historyEntry].slice(-30);
		const completedAt =
			parsedEvent.completedAt ??
			(parsedEvent.status === "ready"
				? now
				: readMetadataString(currentTraining, "completedAt"));
		const currentDatasetUrl = readMetadataString(currentTraining, "datasetUrl");
		const currentDatasetZipSizeBytes = readMetadataNumber(
			currentTraining,
			"datasetZipSizeBytes"
		);
		const currentDebugCorrelationId = readMetadataString(
			currentTraining,
			"debugCorrelationId"
		);
		const failedAt =
			parsedEvent.failedAt ??
			(parsedEvent.status === "failed"
				? now
				: readMetadataString(currentTraining, "failedAt"));
		const currentLoraUrl = readMetadataString(currentTraining, "loraUrl");
		const currentProvider = readMetadataString(currentTraining, "provider");
		const currentReferenceImageTargetCount = readMetadataNumber(
			currentTraining,
			"referenceImageTargetCount"
		);
		const referenceImageTargetCount =
			typeof parsedEvent.referenceImageTargetCount === "number"
				? parsedEvent.referenceImageTargetCount
				: (currentReferenceImageTargetCount ??
					(nextReferenceImageUrls.length > 0
						? nextReferenceImageUrls.length
						: null));
		const startedAtValue =
			readMetadataString(currentTraining, "startedAt") ?? now;
		const currentTrainingElapsedMs = readMetadataNumber(
			currentTraining,
			"trainingElapsedMs"
		);
		const trainingElapsedMs =
			typeof parsedEvent.trainingElapsedMs === "number"
				? parsedEvent.trainingElapsedMs
				: currentTrainingElapsedMs;
		const currentTrainingStartedAt = readMetadataString(
			currentTraining,
			"trainingStartedAt"
		);
		const trainingStartedAt =
			parsedEvent.trainingStartedAt ??
			(parsedEvent.status === "training"
				? (currentTrainingStartedAt ?? now)
				: currentTrainingStartedAt);
		const currentTrainingSteps = readMetadataNumber(
			currentTraining,
			"trainingSteps"
		);
		const trainingSteps =
			typeof parsedEvent.trainingSteps === "number"
				? parsedEvent.trainingSteps
				: currentTrainingSteps;
		const currentTriggerWord = readMetadataString(
			currentTraining,
			"triggerWord"
		);
		const currentUploadMethod = readMetadataString(
			currentTraining,
			"uploadMethod"
		);
		const nextTrainingMetadata = {
			...currentTraining,
			assetReleaseId:
				parsedEvent.assetReleaseId ??
				readMetadataString(currentTraining, "assetReleaseId"),
			completedAt,
			datasetUrl:
				parsedEvent.datasetUrl ?? currentDatasetUrl ?? person.datasetUrl,
			datasetZipSizeBytes:
				typeof parsedEvent.datasetZipSizeBytes === "number"
					? parsedEvent.datasetZipSizeBytes
					: currentDatasetZipSizeBytes,
			debug: nextDebug,
			debugCorrelationId:
				parsedEvent.debugCorrelationId ?? currentDebugCorrelationId,
			errorSummary: parsedEvent.errorSummary ?? null,
			failedAt,
			history: nextHistory,
			lastEventAt: parsedEvent.lastEventAt ?? now,
			loraUrl: parsedEvent.loraUrl ?? currentLoraUrl ?? person.loraUrl,
			phase: nextPhase,
			progressPct: nextProgressPct,
			provider: parsedEvent.provider ?? currentProvider,
			providerJobId: nextProviderJobId,
			providerRequestId: nextProviderRequestId,
			providerStatus: nextProviderStatus,
			referenceImageCount: nextReferenceImageCount,
			referenceImageTargetCount,
			referenceImageUrls: nextReferenceImageUrls,
			startedAt: startedAtValue,
			status: parsedEvent.status,
			trainingElapsedMs,
			trainingRunId: currentTrainingRunId ?? callbackTrainingRunId,
			trainingStartedAt,
			trainingSteps,
			triggerWord: parsedEvent.triggerWord ?? currentTriggerWord,
			updatedAt: now,
			uploadMethod: parsedEvent.uploadMethod ?? currentUploadMethod,
		};

		if (parsedEvent.referenceImageUrls?.length) {
			const nextDatasetUrls = [...new Set(nextReferenceImageUrls)];
			await this.repository.deleteDatasetGenerations(personId, nextDatasetUrls);
			const existingDatasetUrls = new Set(
				(await this.repository.getPersonById(personId))?.generations
					.filter((g) => g.metadata.isDatasetPhoto === true)
					.map((g) => g.sourceUrl) ?? []
			);

			for (const [index, url] of nextDatasetUrls.entries()) {
				if (!existingDatasetUrls.has(url)) {
					await this.repository.createGeneration({
						id: crypto.randomUUID(),
						personId,
						title: `Dataset photo ${index + 1}`,
						prompt: "",
						mediaType: "image",
						status: "ready",
						previewUrl: url,
						sourceUrl: url,
						operatorRunId: null,
						operatorScenarioId: null,
						errorSummary: null,
						metadata: { isDatasetPhoto: true },
					});
				}
			}
		}

		return this.repository.updatePerson(personId, {
			datasetUrl: parsedEvent.datasetUrl ?? person.datasetUrl,
			loraUrl: parsedEvent.loraUrl ?? person.loraUrl,
			metadata: {
				...person.metadata,
				training: nextTrainingMetadata,
			},
		});
	}

	async importGenerationFromServer(
		personId: string,
		input: z.input<typeof importServerGenerationInputSchema>
	) {
		const parsed = importServerGenerationInputSchema.parse(input);
		const person = await this.repository.getPersonById(personId);

		if (!person) {
			return null;
		}

		if (!this.operatorServerClient) {
			throw new Error("Generator integration is not configured");
		}

		const existingGeneration =
			await this.repository.getGenerationByOperatorRunId(parsed.providerJobId);
		if (existingGeneration) {
			throw new Error("This generator execution has already been imported");
		}

		const execution = await this.operatorServerClient.syncExecution({
			providerEndpointId: parsed.providerEndpointId,
			providerJobId: parsed.providerJobId,
			workflowKey: parsed.workflowKey,
		});
		if (execution.status !== "succeeded") {
			throw new Error("Only succeeded generator executions can be imported");
		}

		const artifacts = execution.artifacts ?? [];
		const primaryArtifactUrl = artifacts[0]?.url;
		if (!primaryArtifactUrl) {
			throw new Error("Generator execution does not contain any artifacts");
		}

		return this.repository.createGeneration({
			id: crypto.randomUUID(),
			personId,
			title: parsed.title ?? "Imported execution",
			prompt: parsed.prompt ?? "",
			mediaType: inferMediaTypeFromUrl(primaryArtifactUrl),
			status: "ready",
			previewUrl: primaryArtifactUrl,
			sourceUrl: primaryArtifactUrl,
			operatorRunId: execution.providerJobId,
			operatorScenarioId: null,
			errorSummary: null,
			metadata: {
				importedFrom: "apps/server",
				inputImageUrl: execution.inputImageUrl,
				workflowKey: execution.workflowKey,
			},
		});
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: execution callback branches
	async applyExecutionCallback(input: {
		context: Record<string, unknown>;
		execution: GeneratorExecutionRecord;
	}) {
		const generationId =
			typeof input.context.generationId === "string"
				? input.context.generationId
				: null;
		const personId =
			typeof input.context.personId === "string"
				? input.context.personId
				: null;
		if (!(generationId && personId)) {
			throw new Error("Invalid persons execution callback context");
		}

		const currentPerson = await this.repository.getPersonById(personId);
		if (!currentPerson) {
			return null;
		}
		const currentGeneration = currentPerson.generations.find(
			(generation) => generation.id === generationId
		);
		if (!currentGeneration) {
			return null;
		}

		const nextMetadata = getGenerationProgressMetadata({
			execution: input.execution,
			metadata: {
				...currentGeneration.metadata,
				generatorExecutionId:
					readMetadataString(
						currentGeneration.metadata,
						"generatorExecutionId"
					) ?? input.execution.id,
				generatorWorkflowKey: input.execution.workflowKey,
			},
		});
		const operatorRunId =
			input.execution.providerJobId ?? currentGeneration.operatorRunId;

		if (
			(input.execution.status === "queued" ||
				input.execution.status === "running") &&
			(operatorRunId !== currentGeneration.operatorRunId ||
				hasProgressMetadataChanged(currentGeneration.metadata, input.execution))
		) {
			await this.repository.updateGeneration(generationId, {
				metadata: nextMetadata,
				operatorRunId,
			});
		}

		if (input.execution.status === "succeeded") {
			const primaryArtifactUrl = input.execution.artifacts[0]?.url;
			if (!primaryArtifactUrl) {
				throw new Error("Execution callback does not contain an artifact");
			}

			const isLoraGeneration =
				currentGeneration.metadata.generatedWithLora === true;

			if (!isLoraGeneration) {
				await this.repository.updatePerson(personId, {
					photoUrl: primaryArtifactUrl,
					referencePhotoUrl: primaryArtifactUrl,
				});
			}

			await this.repository.updateGeneration(generationId, {
				errorSummary: null,
				metadata: nextMetadata,
				operatorRunId,
				previewUrl: primaryArtifactUrl,
				sourceUrl: primaryArtifactUrl,
				status: "ready",
				title: isLoraGeneration ? "LoRA generation" : "Generated avatar",
			});

			if (!isLoraGeneration) {
				const shouldAutoTrain =
					currentPerson.metadata.autoStartTraining === true;
				if (shouldAutoTrain && this.adminTrainingClient) {
					const freshPerson = await this.repository.getPersonById(personId);
					if (freshPerson) {
						await this.startLoraTraining(personId, {
							outputName: undefined,
							referencePrompt: undefined,
							triggerWord: undefined,
						});
					}
				}
			}
		} else if (input.execution.status === "failed") {
			const isLoraGeneration =
				currentGeneration.metadata.generatedWithLora === true;
			await this.repository.updateGeneration(generationId, {
				errorSummary:
					input.execution.errorSummary ??
					(isLoraGeneration
						? "LoRA generation failed"
						: "Avatar generation failed"),
				metadata: nextMetadata,
				operatorRunId,
				status: "failed",
				title: isLoraGeneration
					? "LoRA generation failed"
					: "Avatar generation failed",
			});
		}

		return this.repository.getPersonById(personId);
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: reconciliation loop
	async reconcileQueuedGenerations(limit = 10) {
		if (!this.operatorServerClient) {
			return { updatedCount: 0 };
		}

		let updatedCount = 0;
		for (const generation of await this.repository.listQueuedGenerations(
			limit
		)) {
			const executionId =
				typeof generation.metadata.generatorExecutionId === "string"
					? generation.metadata.generatorExecutionId
					: null;
			if (!executionId) {
				continue;
			}
			const execution =
				await this.operatorServerClient.getExecution(executionId);
			const nextMetadata = getGenerationProgressMetadata({
				execution,
				metadata: {
					...generation.metadata,
					generatorExecutionId: execution.id,
					generatorWorkflowKey: execution.workflowKey,
				},
			});
			const operatorRunId = execution.providerJobId ?? generation.operatorRunId;
			const shouldUpdateProgress =
				operatorRunId !== generation.operatorRunId ||
				hasProgressMetadataChanged(generation.metadata, execution);
			if (
				(execution.status === "queued" || execution.status === "running") &&
				shouldUpdateProgress
			) {
				await this.repository.updateGeneration(generation.id, {
					metadata: nextMetadata,
					operatorRunId,
				});
				updatedCount += 1;
			}
			if (execution.status === "succeeded") {
				const primaryArtifactUrl = execution.artifacts[0]?.url;
				if (!primaryArtifactUrl) {
					continue;
				}
				const isLoraGeneration = generation.metadata.generatedWithLora === true;
				if (!isLoraGeneration) {
					await this.repository.updatePerson(generation.personId, {
						photoUrl: primaryArtifactUrl,
						referencePhotoUrl: primaryArtifactUrl,
					});
				}
				await this.repository.updateGeneration(generation.id, {
					errorSummary: null,
					metadata: nextMetadata,
					operatorRunId,
					previewUrl: primaryArtifactUrl,
					sourceUrl: primaryArtifactUrl,
					status: "ready",
					title: isLoraGeneration ? "LoRA generation" : "Generated avatar",
				});
				updatedCount += 1;
				continue;
			}
			if (execution.status === "failed") {
				const isLoraGeneration = generation.metadata.generatedWithLora === true;
				await this.repository.updateGeneration(generation.id, {
					errorSummary:
						execution.errorSummary ??
						(isLoraGeneration
							? "LoRA generation failed"
							: "Avatar generation failed"),
					metadata: nextMetadata,
					operatorRunId,
					status: "failed",
					title: isLoraGeneration
						? "LoRA generation failed"
						: "Avatar generation failed",
				});
				updatedCount += 1;
			}
		}
		return { updatedCount };
	}

	private async ensureUniqueSlug(slug: string, currentPersonId?: string) {
		let candidateSlug = slug;
		let suffix = 1;

		while (true) {
			const existingPerson =
				await this.repository.getPersonBySlug(candidateSlug);
			if (!existingPerson || existingPerson.id === currentPersonId) {
				return candidateSlug;
			}

			suffix += 1;
			candidateSlug = `${slug}-${suffix}`;
		}
	}
}
