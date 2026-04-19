import type { GeneratorExecutionRecord } from "@generator/contracts/generator";
import {
	isActivePersonLoraTrainingStatus,
	PERSONS_AVATAR_WORKFLOWS,
} from "@generator/contracts/persons";
import { env } from "@generator/env/server";
import type { GeneratorExecutionClient } from "@generator/generator-client-server";
import {
	deleteObjectFromS3,
	extractS3KeyFromPublicUrl,
	type S3StorageConfig,
} from "@generator/storage";
import { z } from "zod";
import type { AdminTrainingClient } from "@/clients/admin-training";
import type { GrokClient } from "@/clients/grok";

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

const nullableOptionalUrlSchema = z.preprocess((value) => {
	if (value === null) {
		return null;
	}

	if (typeof value !== "string") {
		return value;
	}

	const trimmedValue = value.trim();
	return trimmedValue.length > 0 ? trimmedValue : null;
}, z.url().nullable().optional());

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
		datasetUrl: nullableOptionalUrlSchema,
		loraUrl: nullableOptionalUrlSchema,
		photoUrl: nullableOptionalUrlSchema,
		videoUrl: nullableOptionalUrlSchema,
		voiceWavUrl: nullableOptionalUrlSchema,
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "At least one field must be provided",
	});

type ParsedUpdatePersonInput = z.output<typeof updatePersonInputSchema>;
type PersonUpdatePatch = Partial<
	Omit<PersonRecord, "createdAt" | "updatedAt" | "generations">
>;
type NullablePersonUrlKey =
	| "datasetUrl"
	| "loraUrl"
	| "photoUrl"
	| "videoUrl"
	| "voiceWavUrl";

const nullablePersonUrlKeys = [
	"datasetUrl",
	"loraUrl",
	"photoUrl",
	"videoUrl",
	"voiceWavUrl",
] as const satisfies readonly NullablePersonUrlKey[];

function setNullablePersonUrl(
	updateInput: PersonUpdatePatch,
	parsed: ParsedUpdatePersonInput,
	key: NullablePersonUrlKey
) {
	if (key in parsed) {
		updateInput[key] = parsed[key] ?? null;
	}
}

function buildPersonUpdatePatch(
	parsed: ParsedUpdatePersonInput,
	nextSlug: string | undefined
): PersonUpdatePatch {
	const updateInput: PersonUpdatePatch = {};

	if (typeof parsed.name === "string") {
		updateInput.name = parsed.name;
	}
	if (nextSlug) {
		updateInput.slug = nextSlug;
	}
	if (typeof parsed.description === "string") {
		updateInput.description = parsed.description;
	}
	if (typeof parsed.referencePhotoUrl === "string") {
		updateInput.referencePhotoUrl = parsed.referencePhotoUrl;
	}
	for (const key of nullablePersonUrlKeys) {
		setNullablePersonUrl(updateInput, parsed, key);
	}
	if (parsed.metadata) {
		updateInput.metadata = parsed.metadata;
	}

	return updateInput;
}

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

export const requestAvatarPreviewsInputSchema = z.object({
	prompt: z.string().trim().min(1, "Avatar prompt is required"),
	count: z.number().int().min(1).max(4).default(4),
	enhance: z.boolean().optional().default(false),
});

export const refineAvatarPreviewsInputSchema = z.object({
	sourcePrompt: z.string().trim().min(1, "Source prompt is required"),
	sourceImageUrl: z.url("Source image URL must be a valid URL"),
	instruction: z
		.string()
		.trim()
		.min(1, "Edit instruction is required")
		.max(2000, "Edit instruction is too long"),
	count: z.number().int().min(1).max(4).default(4),
});

export interface AvatarPreviewBatch {
	enhanced: boolean;
	executions: GeneratorExecutionRecord[];
	prompts: string[];
}

const AVATAR_PREVIEW_WORKFLOW_KEY = PERSONS_AVATAR_WORKFLOWS.preview;
const AVATAR_REFINE_WORKFLOW_KEY = PERSONS_AVATAR_WORKFLOWS.refine;

export const startPersonLoraTrainingInputSchema = z.object({
	outputName: optionalStringSchema,
	/**
	 * Если `true` — заставляет admin runner заново нагенерить reference-датасет
	 * (19 fal.ai/flux-2/edit вариаций + 6 копий оригинала). По умолчанию
	 * `false`: при retrain'е переиспользуем `person.datasetUrl` от предыдущей
	 * успешной тренировки, экономим ~5 минут и ~$0.20 на каждом ретрейне.
	 */
	regenerateDataset: z.boolean().optional(),
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
	"awaiting-approval",
]);

/**
 * Per-photo dataset descriptor emitted by the admin runner. Persons-service
 * upserts dataset generations by `variantId` (NOT by `sourceUrl`) so a refill
 * for the same slot replaces the previous row instead of creating a duplicate
 * and leaks no orphan S3 objects.
 */
const referenceImageItemSchema = z.object({
	caption: z.string(),
	s3Key: z.string().nullable(),
	url: z.url(),
	variantId: z.string().min(1),
});

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
	referenceImageItems: z.array(referenceImageItemSchema).optional(),
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

/**
 * Builds the canonical trigger word for a person LoRA. Mirrors
 * `buildDefaultTriggerWord` in the admin training runner so a person whose
 * trigger has not been explicitly stored yet still resolves to the same
 * `ohwx_<slug>` token at inference time. The `ohwx` prefix is a rare token
 * that the base model has no associations with, so all identity weight stays
 * with the LoRA rather than leaking through the person's name.
 */
function buildDefaultPersonTriggerWord(slug: string) {
	const sanitized = slug.replace(/-/g, "_").slice(0, 48);
	const stem = sanitized.length > 0 ? sanitized : "person";
	return `ohwx_${stem}`.slice(0, 60);
}

const imageMediaUrlPattern = /\.(png|jpe?g|webp|gif)(\?.*)?$/;
const audioMediaUrlPattern = /\.(wav|mp3|ogg|m4a)(\?.*)?$/;
const CANCELLED_GENERATION_ERROR = "Generation cancelled by operator";
const CANCELLED_LORA_PIPELINE_ERROR = "LoRA pipeline cancelled by operator";

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

function appendUniqueUrls(base: string[], extra: string[]): string[] {
	const seen = new Set(base);
	const next = [...base];
	for (const url of extra) {
		if (typeof url !== "string" || url.length === 0 || seen.has(url)) {
			continue;
		}
		seen.add(url);
		next.push(url);
	}
	return next;
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

export interface PersonsServiceDependencies {
	adminTrainingClient?: AdminTrainingClient;
	callbackConfig?: { token: string; url?: string };
	grokClient?: GrokClient;
	operatorServerClient?: OperatorServerClient;
	repository: PersonsRepository;
	s3Storage?: S3StorageConfig;
}

export class PersonsService {
	private readonly repository: PersonsRepository;
	private readonly operatorServerClient?: OperatorServerClient;
	private readonly callbackConfig?: { token: string; url?: string };
	private readonly adminTrainingClient?: AdminTrainingClient;
	private readonly grokClient?: GrokClient;
	private readonly s3Storage?: S3StorageConfig;

	constructor(deps: PersonsServiceDependencies);
	constructor(
		repository: PersonsRepository,
		operatorServerClient?: OperatorServerClient,
		callbackConfig?: { token: string; url?: string },
		adminTrainingClient?: AdminTrainingClient,
		grokClient?: GrokClient
	);
	constructor(
		repositoryOrDeps: PersonsRepository | PersonsServiceDependencies,
		operatorServerClient?: OperatorServerClient,
		callbackConfig?: { token: string; url?: string },
		adminTrainingClient?: AdminTrainingClient,
		grokClient?: GrokClient
	) {
		const deps: PersonsServiceDependencies =
			"repository" in repositoryOrDeps
				? repositoryOrDeps
				: {
						adminTrainingClient,
						callbackConfig,
						grokClient,
						operatorServerClient,
						repository: repositoryOrDeps,
					};
		this.repository = deps.repository;
		this.operatorServerClient = deps.operatorServerClient;
		this.callbackConfig = deps.callbackConfig;
		this.adminTrainingClient = deps.adminTrainingClient;
		this.grokClient = deps.grokClient;
		this.s3Storage = deps.s3Storage;
	}

	private async deleteS3ObjectQuietly(s3Key: string | null) {
		if (!(s3Key && this.s3Storage)) {
			return;
		}
		try {
			await deleteObjectFromS3(s3Key, this.s3Storage);
		} catch (error) {
			console.error("persons.s3.delete.error", {
				key: s3Key,
				message: error instanceof Error ? error.message : "unknown",
			});
		}
	}

	private resolveS3KeyForGeneration(
		generation: PersonGenerationRecord
	): string | null {
		const stored = readMetadataString(generation.metadata, "datasetS3Key");
		if (stored) {
			return stored;
		}
		if (!this.s3Storage) {
			return null;
		}
		return extractS3KeyFromPublicUrl(generation.sourceUrl, this.s3Storage);
	}

	private createExecutionCallback(context: Record<string, unknown>) {
		if (!this.callbackConfig) {
			return undefined;
		}

		return {
			context,
			token: this.callbackConfig.token,
			...(this.callbackConfig.url ? { url: this.callbackConfig.url } : {}),
		};
	}

	get isGrokEnhanceConfigured() {
		return Boolean(this.grokClient);
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

	async requestAvatarPreviews(
		input: z.input<typeof requestAvatarPreviewsInputSchema>,
		options?: {
			debugCorrelationId?: string;
		}
	): Promise<AvatarPreviewBatch> {
		const parsed = requestAvatarPreviewsInputSchema.parse(input);
		if (!this.operatorServerClient) {
			throw new Error("Generator integration is not configured");
		}

		const debugCorrelationId = options?.debugCorrelationId;
		const operatorServerClient = this.operatorServerClient;

		const enhanced = parsed.enhance && Boolean(this.grokClient);
		const prompts = enhanced
			? await this.buildEnhancedPrompts(parsed.prompt, parsed.count)
			: [parsed.prompt];

		const buildParams = (numImages: number) => ({
			imageSize: "portrait_4_3",
			guidanceScale: 2.5,
			numImages,
			enableSafetyChecker: false,
			enablePromptExpansion: false,
			outputFormat: "png",
		});

		if (!enhanced) {
			const execution = await operatorServerClient.createExecution(
				{
					workflowKey: AVATAR_PREVIEW_WORKFLOW_KEY,
					prompt: parsed.prompt,
					params: buildParams(parsed.count),
				},
				{ debugCorrelationId }
			);
			return { enhanced: false, executions: [execution], prompts };
		}

		const executions = await Promise.all(
			prompts.map((prompt) =>
				operatorServerClient.createExecution(
					{
						workflowKey: AVATAR_PREVIEW_WORKFLOW_KEY,
						prompt,
						params: buildParams(1),
					},
					{ debugCorrelationId }
				)
			)
		);

		return { enhanced: true, executions, prompts };
	}

	async refineAvatarPreviews(
		input: z.input<typeof refineAvatarPreviewsInputSchema>,
		options?: {
			debugCorrelationId?: string;
		}
	): Promise<AvatarPreviewBatch> {
		const parsed = refineAvatarPreviewsInputSchema.parse(input);
		if (!this.operatorServerClient) {
			throw new Error("Generator integration is not configured");
		}
		if (!this.grokClient) {
			throw new Error("Prompt refinement is not configured on this server.");
		}

		const refinedPrompt = await this.grokClient.refinePrompt({
			basePrompt: parsed.sourcePrompt,
			instruction: parsed.instruction,
		});
		const finalPrompt =
			refinedPrompt.trim().length > 0 ? refinedPrompt : parsed.sourcePrompt;

		const execution = await this.operatorServerClient.createExecution(
			{
				workflowKey: AVATAR_REFINE_WORKFLOW_KEY,
				prompt: finalPrompt,
				inputImageUrl: parsed.sourceImageUrl,
				params: {
					imageSize: "auto",
					guidanceScale: 2.5,
					numInferenceSteps: 28,
					numImages: parsed.count,
					enableSafetyChecker: false,
				},
			},
			{ debugCorrelationId: options?.debugCorrelationId }
		);

		return {
			enhanced: true,
			executions: [execution],
			prompts: [finalPrompt],
		};
	}

	private async buildEnhancedPrompts(
		basePrompt: string,
		count: number
	): Promise<string[]> {
		if (!this.grokClient) {
			return [basePrompt];
		}

		const targetCount = Math.max(1, count);
		const variantCount = Math.max(0, targetCount - 1);
		const [enhanced, variants] = await Promise.all([
			this.grokClient.enhancePrompt(basePrompt),
			variantCount > 0
				? this.grokClient.expandPrompt({
						prompt: basePrompt,
						count: variantCount,
					})
				: Promise.resolve<string[]>([]),
		]);

		const combined = [enhanced, ...variants]
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);

		while (combined.length < targetCount) {
			combined.push(basePrompt);
		}

		return combined.slice(0, targetCount);
	}

	private async resolveOptionalGrokEnhancedPrompt(
		userPrompt: string,
		shouldEnhance: boolean
	): Promise<string> {
		if (!(shouldEnhance && this.grokClient)) {
			return userPrompt;
		}
		try {
			const enhanced = await this.grokClient.enhancePrompt(userPrompt);
			return enhanced.trim().length > 0 ? enhanced : userPrompt;
		} catch {
			return userPrompt;
		}
	}

	private async resolveExtraLoraUrlWithCaching(
		url: string | undefined
	): Promise<string | undefined> {
		if (!(url && this.adminTrainingClient)) {
			return url;
		}
		try {
			return await this.adminTrainingClient.cacheExternalLora(url);
		} catch {
			return url;
		}
	}

	getAvatarPreview(
		executionId: string,
		options?: {
			debugCorrelationId?: string;
		}
	) {
		if (!this.operatorServerClient) {
			throw new Error("Generator integration is not configured");
		}
		return this.operatorServerClient.getExecution(executionId, {
			debugCorrelationId: options?.debugCorrelationId,
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
			callback: this.createExecutionCallback({
				generationId: queuedGeneration.id,
				personId: createdPerson.id,
			}),
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

		const nextSlug = await this.resolveUpdatedSlug(parsed, current, personId);
		return this.repository.updatePerson(
			personId,
			buildPersonUpdatePatch(parsed, nextSlug)
		);
	}

	private resolveUpdatedSlug(
		parsed: ParsedUpdatePersonInput,
		current: PersonRecord,
		personId: string
	) {
		if (typeof parsed.slug === "string") {
			const candidateSlug = slugifySegment(parsed.slug);
			return candidateSlug.length > 0
				? this.ensureUniqueSlug(candidateSlug, personId)
				: current.slug;
		}

		if (typeof parsed.name !== "string") {
			return undefined;
		}

		const candidateSlug = slugifySegment(parsed.name);
		if (candidateSlug.length === 0 || candidateSlug === current.slug) {
			return undefined;
		}

		return this.ensureUniqueSlug(candidateSlug, personId);
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

		const variantId = readMetadataString(
			deletedGeneration.metadata,
			"datasetVariantId"
		);
		// Original reference photo duplicates are essential for training and
		// must never be removed individually — the UI hides the Delete button
		// for them. This server-side guard exists so a stray DELETE request
		// (e.g. via API client or replayed event) cannot leave the dataset
		// short an "anchor" copy of the canonical reference photo.
		if (variantId?.startsWith("original-")) {
			return this.repository.getPersonById(personId);
		}

		await this.deleteS3ObjectQuietly(
			this.resolveS3KeyForGeneration(deletedGeneration)
		);

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

		// Track variants that the operator just rejected so the dataset
		// gallery can render placeholder slots and the Train CTA stays gated
		// until every refill arrives. Only synth slots (variantId !== null,
		// not `original-*` — already filtered above) participate; without a
		// variantId we cannot reliably correlate the incoming refill back to
		// a pending slot, so we do not gate Train in that edge case.
		const nextPendingRefillVariantIds = this.appendPendingRefillVariantId(
			training,
			variantId
		);

		await this.repository.updatePerson(personId, {
			metadata: {
				...person.metadata,
				training: {
					...training,
					pendingRefillVariantIds: nextPendingRefillVariantIds,
					referenceImageCount: nextReferenceImageUrls.length,
					referenceImageUrls: nextReferenceImageUrls,
				},
			},
		});

		await this.maybePublishVariantRefill({
			deletedGeneration,
			person,
			training,
			variantId,
		});

		return this.repository.getPersonById(personId);
	}

	private appendPendingRefillVariantId(
		training: Record<string, unknown>,
		variantId: string | null
	): string[] {
		const existing = Array.isArray(training.pendingRefillVariantIds)
			? training.pendingRefillVariantIds.filter(
					(value): value is string =>
						typeof value === "string" && value.length > 0
				)
			: [];
		if (!variantId) {
			return existing;
		}
		// Only refill while the dataset is still mutable. After the operator
		// confirms training (status flips to `training`/`publishing`/`ready`)
		// nothing will ever clear the pending entry, so the Train CTA would
		// stay disabled forever — `maybePublishVariantRefill` already short
		// circuits in that case, mirror it here.
		const trainingStatus = readMetadataString(training, "status");
		const isDatasetMutable =
			trainingStatus === "queued" ||
			trainingStatus === "generating" ||
			trainingStatus === "awaiting-approval";
		if (!isDatasetMutable) {
			return existing;
		}
		if (existing.includes(variantId)) {
			return existing;
		}
		return [...existing, variantId];
	}

	/**
	 * Auto-refills a single dataset variant slot whenever the operator removes
	 * a synthetic reference photo while the LoRA pipeline is awaiting approval
	 * (or the underlying admin runner is still mid dataset prep). The intent
	 * is "every reject triggers exactly one regeneration for that slot" so the
	 * dataset converges back to its target size without operator action.
	 *
	 * The refill is a best-effort fire-and-forget because:
	 *   - the rejected row has already been deleted from the DB,
	 *   - the corresponding S3 object has already been deleted, and
	 *   - admin worker carries its own idempotency guard for the same
	 *     `(personId, trainingRunId, variantId)` triple.
	 * If the publish fails, the operator can manually click "Regenerate" from
	 * the persons-web UI without leaving the dataset in an inconsistent state.
	 */
	private async maybePublishVariantRefill(input: {
		deletedGeneration: PersonGenerationRecord;
		person: PersonRecord;
		training: Record<string, unknown>;
		variantId: string | null;
	}) {
		if (!(input.variantId && this.adminTrainingClient?.requestVariantRefill)) {
			return;
		}
		const trainingStatus = readMetadataString(input.training, "status");
		// Only auto-refill while the dataset is still in scope: prep, awaiting
		// approval, or queued. After the operator hits Train (status moves to
		// `training`/`publishing`/`ready`) the dataset is frozen.
		const isDatasetMutable =
			trainingStatus === "queued" ||
			trainingStatus === "generating" ||
			trainingStatus === "awaiting-approval";
		if (!isDatasetMutable) {
			return;
		}
		const trainingRunId = readMetadataString(input.training, "trainingRunId");
		if (!trainingRunId) {
			return;
		}
		const triggerWord = readMetadataString(input.training, "triggerWord");

		try {
			await this.adminTrainingClient.requestVariantRefill({
				debugCorrelationId:
					readMetadataString(input.training, "debugCorrelationId") ?? undefined,
				description: input.person.description,
				personId: input.person.id,
				personSlug: input.person.slug,
				referencePhotoUrl: input.person.referencePhotoUrl,
				// `requestNonce` lets the admin worker dedupe replays of the
				// same rejection without re-running fal.ai. We bind it to the
				// (trainingRunId, variantId) pair plus a fresh UUID so distinct
				// rejections of the same slot (operator rejects, worker
				// regenerates, operator rejects again) each get their own key.
				requestNonce: `${trainingRunId}:${input.variantId}:${crypto.randomUUID()}`,
				trainingRunId,
				triggerWord:
					triggerWord ??
					buildDefaultPersonTriggerWord(input.person.slug || input.person.id),
				variantId: input.variantId,
			});
		} catch (error) {
			console.error("persons.refill.publish.error", {
				message: error instanceof Error ? error.message : "unknown",
				personId: input.person.id,
				variantId: input.variantId,
			});
		}
	}

	async cancelGeneration(personId: string, generationId: string) {
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

		if (generation.status !== "queued") {
			return person;
		}

		const cancelledAt = new Date().toISOString();
		const generatorExecutionId = readMetadataString(
			generation.metadata,
			"generatorExecutionId"
		);
		let cancellationError: string | null = null;

		if (generatorExecutionId && this.operatorServerClient) {
			try {
				await this.operatorServerClient.cancelExecution(generatorExecutionId);
			} catch (error) {
				cancellationError =
					error instanceof Error ? error.message : "Generator cancel failed";
			}
		}

		const metadata = {
			...generation.metadata,
			cancelledAt,
			generatorStatus: "failed",
			progressPct: 100,
			...(cancellationError ? { cancellationError } : {}),
		};

		await this.repository.updateGeneration(generationId, {
			errorSummary: cancellationError
				? `${CANCELLED_GENERATION_ERROR}; generator cancel failed: ${cancellationError}`
				: CANCELLED_GENERATION_ERROR,
			metadata,
			status: "failed",
		});

		return this.repository.getPersonById(personId);
	}

	async cancelLoraTraining(personId: string) {
		const person = await this.repository.getPersonById(personId);

		if (!person) {
			return null;
		}

		const training =
			person.metadata.training &&
			typeof person.metadata.training === "object" &&
			!Array.isArray(person.metadata.training)
				? (person.metadata.training as Record<string, unknown>)
				: null;
		const trainingStatus = readMetadataString(training ?? {}, "status");

		if (!(training && isActivePersonLoraTrainingStatus(trainingStatus))) {
			return person;
		}

		const cancelledAt = new Date().toISOString();
		const currentHistory = Array.isArray(training.history)
			? training.history.filter(
					(entry): entry is Record<string, unknown> =>
						typeof entry === "object" && entry !== null && !Array.isArray(entry)
				)
			: [];
		const historyEntry = {
			at: cancelledAt,
			errorSummary: CANCELLED_LORA_PIPELINE_ERROR,
			phase: "cancelled",
			progressPct: 100,
			providerJobId: readMetadataString(training, "providerJobId"),
			providerRequestId: readMetadataString(training, "providerRequestId"),
			providerStatus: readMetadataString(training, "providerStatus"),
			referenceImageCount: readMetadataNumber(training, "referenceImageCount"),
			status: "failed",
		};
		const nextHistory = [...currentHistory, historyEntry].slice(-30);

		return this.repository.updatePerson(personId, {
			metadata: {
				...person.metadata,
				autoStartTraining: false,
				training: {
					...training,
					cancelledAt,
					errorSummary: CANCELLED_LORA_PIPELINE_ERROR,
					failedAt: cancelledAt,
					history: nextHistory,
					lastEventAt: cancelledAt,
					phase: "cancelled",
					progressPct: 100,
					status: "failed",
					updatedAt: cancelledAt,
				},
			},
		});
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

		const currentTrainingObj =
			person.metadata.training &&
			typeof person.metadata.training === "object" &&
			!Array.isArray(person.metadata.training)
				? (person.metadata.training as Record<string, unknown>)
				: null;
		const currentTrainingStatus = currentTrainingObj?.status;
		// Block while a training run is already active so we never enqueue a
		// duplicate job. A previously-completed training (status === "ready" or
		// person.loraUrl already set) is intentionally allowed to be retrained
		// — that's exactly what the "Retrain LoRA" button is for.
		if (
			typeof currentTrainingStatus === "string" &&
			isActivePersonLoraTrainingStatus(currentTrainingStatus)
		) {
			return person;
		}

		const fallbackTriggerWord = buildDefaultPersonTriggerWord(
			person.slug || person.id
		);
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

		// Reuse existing dataset zip from the previous successful training, unless
		// the operator explicitly requested `regenerateDataset: true`. This skips
		// the ~5min, ~$0.20 worth of fal.ai/flux-2/edit calls done by
		// `buildReferenceDataset` on every retrain.
		const reuseDatasetUrl =
			!parsed.regenerateDataset && person.datasetUrl
				? person.datasetUrl
				: undefined;

		// Approval flow: when no reusable dataset is available we ask the
		// runner to stop after dataset prep and emit `awaiting-approval`. The
		// operator then reviews the per-photo dataset in persons-web and
		// either rejects individual photos (auto-refilled via
		// `requestVariantRefill`) or hits "Train" which routes through
		// `confirmDatasetAndStartTraining` below. Retrains that reuse an
		// existing dataset zip skip the approval step because there's nothing
		// new to review.
		const trainingMode = reuseDatasetUrl ? "auto-train" : "prep-only";

		await this.adminTrainingClient.startPersonLoraTraining(
			{
				debugCorrelationId: options?.debugCorrelationId,
				description: person.description,
				mode: trainingMode,
				outputName,
				personId: person.id,
				personName: person.name,
				personSlug: person.slug,
				referencePhotoUrl: person.referencePhotoUrl,
				referencePrompt: parsed.referencePrompt ?? undefined,
				reuseDatasetUrl,
				trainingRunId,
				triggerWord,
			},
			{
				debugCorrelationId: options?.debugCorrelationId,
			}
		);

		return updatedPerson ?? person;
	}

	/**
	 * Confirms the awaiting-approval dataset and asks the admin runner to
	 * assemble the zip + start the actual LoRA training. The list of approved
	 * dataset items is reconstructed from the current `PersonGenerationRecord`
	 * rows tagged with `isDatasetPhoto: true` — so any photos the operator
	 * deleted (or that arrived via a refill) are automatically excluded /
	 * included without an extra payload from the UI.
	 */
	async confirmDatasetAndStartTraining(
		personId: string,
		options?: { debugCorrelationId?: string }
	) {
		const person = await this.repository.getPersonById(personId);
		if (!person) {
			return null;
		}
		if (!this.adminTrainingClient?.confirmPersonLoraTraining) {
			throw new Error("Admin training integration is not configured");
		}

		const training =
			person.metadata.training &&
			typeof person.metadata.training === "object" &&
			!Array.isArray(person.metadata.training)
				? (person.metadata.training as Record<string, unknown>)
				: null;
		if (!training) {
			throw new Error("Person does not have an active training run");
		}
		if (training.status !== "awaiting-approval") {
			// Nothing to do — caller is replaying a stale Confirm or the
			// pipeline has moved past the approval gate.
			return person;
		}

		const trainingRunId = readMetadataString(training, "trainingRunId");
		const outputName = readMetadataString(training, "outputName");
		const triggerWord = readMetadataString(training, "triggerWord");
		if (!(trainingRunId && outputName && triggerWord)) {
			throw new Error("Training metadata is incomplete");
		}

		const approvedItems = person.generations
			.filter(
				(generation) =>
					generation.metadata.isDatasetPhoto === true &&
					generation.status === "ready"
			)
			.map((generation) => ({
				caption:
					readMetadataString(generation.metadata, "datasetCaption") ?? "",
				s3Key: readMetadataString(generation.metadata, "datasetS3Key"),
				url: generation.sourceUrl,
				variantId:
					readMetadataString(generation.metadata, "datasetVariantId") ??
					generation.id,
			}));

		if (approvedItems.length === 0) {
			throw new Error("No approved dataset items to train on");
		}

		const requestedAt = new Date().toISOString();
		await this.repository.updatePerson(personId, {
			metadata: {
				...person.metadata,
				training: {
					...training,
					lastEventAt: requestedAt,
					phase: "uploading-dataset",
					status: "training",
					updatedAt: requestedAt,
				},
			},
		});

		await this.adminTrainingClient.confirmPersonLoraTraining({
			approvedItems,
			debugCorrelationId:
				options?.debugCorrelationId ??
				readMetadataString(training, "debugCorrelationId") ??
				undefined,
			description: person.description,
			outputName,
			personId: person.id,
			personName: person.name,
			personSlug: person.slug,
			referencePhotoUrl: person.referencePhotoUrl,
			referencePrompt:
				readMetadataString(training, "referencePrompt") ?? undefined,
			trainingRunId,
			triggerWord,
		});

		return this.repository.getPersonById(personId);
	}

	async generateWithLora(
		personId: string,
		userPrompt: string,
		options?: {
			enhance?: boolean;
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
				: buildDefaultPersonTriggerWord(person.slug);
		const genderHint =
			typeof trainingDebug.genderHint === "string"
				? trainingDebug.genderHint
				: inferGenderHint(person.description);

		const shouldEnhance = Boolean(options?.enhance) && Boolean(this.grokClient);
		const effectiveUserPrompt = await this.resolveOptionalGrokEnhancedPrompt(
			userPrompt,
			shouldEnhance
		);

		const subject = genderHint ? `${triggerWord} ${genderHint}` : triggerWord;
		// Prefix and suffix the trigger so the LoRA dominates the user prompt
		// without smuggling any explicit appearance description into the text.
		const prompt = [
			`a photo of ${subject}`,
			effectiveUserPrompt,
			`portrait of ${triggerWord}`,
		]
			.filter((part): part is string => Boolean(part))
			.join(", ");
		const resolvedExtraLoraUrl = await this.resolveExtraLoraUrlWithCaching(
			options?.extraLoraUrl
		);

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
				metadata: {
					workflowKey,
					generatedWithLora: true,
					...(shouldEnhance
						? { enhanced: true, originalPrompt: userPrompt }
						: {}),
				},
			}),
		});

		const execution = await this.operatorServerClient.createExecution({
			callback: this.createExecutionCallback({ generationId, personId }),
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
					...(shouldEnhance
						? { enhanced: true, originalPrompt: userPrompt }
						: {}),
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
		const isCurrentTrainingCancelled =
			readMetadataString(currentTraining, "phase") === "cancelled" ||
			readMetadataString(currentTraining, "cancelledAt") !== null;
		if (isCurrentTrainingCancelled) {
			return person;
		}
		if (
			currentTrainingRunId &&
			(callbackTrainingRunId === null ||
				callbackTrainingRunId !== currentTrainingRunId)
		) {
			return person;
		}
		const baseReferenceImageUrls =
			parsedEvent.referenceImageUrls ??
			(Array.isArray(currentTraining.referenceImageUrls)
				? currentTraining.referenceImageUrls.filter(
						(value): value is string => typeof value === "string"
					)
				: []);
		// Refill events ship `referenceImageItems` (one new variant) without
		// `referenceImageUrls`, so we must splice the new URLs into the
		// existing list — otherwise the dataset gallery (which renders from
		// `referenceImageUrls`) would never surface the regenerated photo
		// even though the per-photo generation row already exists.
		const nextReferenceImageUrls =
			parsedEvent.referenceImageUrls === undefined &&
			parsedEvent.referenceImageItems?.length
				? appendUniqueUrls(
						baseReferenceImageUrls,
						parsedEvent.referenceImageItems.map((item) => item.url)
					)
				: baseReferenceImageUrls;
		const incomingVariantIds = new Set(
			parsedEvent.referenceImageItems?.map((item) => item.variantId) ?? []
		);
		const previousPendingRefillVariantIds = Array.isArray(
			currentTraining.pendingRefillVariantIds
		)
			? currentTraining.pendingRefillVariantIds.filter(
					(value): value is string =>
						typeof value === "string" && value.length > 0
				)
			: [];
		const nextPendingRefillVariantIds = previousPendingRefillVariantIds.filter(
			(value) => !incomingVariantIds.has(value)
		);
		const refilledVariantIds = previousPendingRefillVariantIds.filter((value) =>
			incomingVariantIds.has(value)
		);
		// `awaiting-approval` always wipes the pending list as well — the
		// admin runner re-emits the full dataset snapshot at that point and
		// the operator should review the whole lineup again from scratch.
		const resetPendingForApproval =
			parsedEvent.status === "awaiting-approval" &&
			parsedEvent.phase !== "refilling-references" &&
			(parsedEvent.referenceImageUrls?.length ?? 0) > 0;
		const finalPendingRefillVariantIds = resetPendingForApproval
			? []
			: nextPendingRefillVariantIds;
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
		const currentReferenceImageCount = readMetadataNumber(
			currentTraining,
			"referenceImageCount"
		);
		// Polling events from the training provider don't include
		// `referenceImageCount` (it doesn't change while fal is crunching),
		// so we must keep the previously-recorded value instead of falling
		// back to `referenceImageUrls.length`. The URL list only contains
		// unique entries, while the dataset zip duplicates the original
		// reference photo a few times — using the URL count would silently
		// downgrade the displayed `refs N/M` counter mid-training and make
		// the UI look like dataset prep is incomplete.
		const nextReferenceImageCount =
			typeof parsedEvent.referenceImageCount === "number"
				? parsedEvent.referenceImageCount
				: (currentReferenceImageCount ?? nextReferenceImageUrls.length);
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
			pendingRefillVariantIds: finalPendingRefillVariantIds,
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

		if (parsedEvent.referenceImageItems?.length) {
			await this.upsertDatasetGenerationsByVariantId(
				personId,
				parsedEvent.referenceImageItems,
				{ refilledVariantIds: new Set(refilledVariantIds) }
			);
		} else if (parsedEvent.referenceImageUrls?.length) {
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

		const updatedPerson = await this.repository.updatePerson(personId, {
			datasetUrl: parsedEvent.datasetUrl ?? person.datasetUrl,
			loraUrl: parsedEvent.loraUrl ?? person.loraUrl,
			metadata: {
				...person.metadata,
				training: nextTrainingMetadata,
			},
		});

		// LoRA is published — the per-photo dataset is no longer needed
		// (`person.datasetUrl` retains the assembled training zip for retrains).
		// Clean up both the DB rows and the underlying S3 objects so storage
		// costs stop accruing for completed persons.
		if (parsedEvent.status === "ready" && parsedEvent.loraUrl) {
			await this.cleanupDatasetAfterTraining(personId);
		}

		return updatedPerson;
	}

	private datasetPhotoItemUpToDate(
		existing: PersonGenerationRecord,
		item: {
			caption: string;
			s3Key: string | null;
			url: string;
			variantId: string;
		}
	): boolean {
		return (
			existing.sourceUrl === item.url &&
			existing.previewUrl === item.url &&
			readMetadataString(existing.metadata, "datasetCaption") ===
				item.caption &&
			readMetadataString(existing.metadata, "datasetS3Key") ===
				(item.s3Key ?? null)
		);
	}

	private async deleteDatasetGenerationsNotInIncomingSet(
		personId: string,
		incomingVariantIds: Set<string>,
		existingByVariantId: Map<string, PersonGenerationRecord>,
		existingDatasetWithoutVariant: PersonGenerationRecord[]
	) {
		for (const [variantId, generation] of existingByVariantId.entries()) {
			if (!incomingVariantIds.has(variantId)) {
				await this.repository.deleteGeneration(personId, generation.id);
			}
		}
		for (const generation of existingDatasetWithoutVariant) {
			await this.repository.deleteGeneration(personId, generation.id);
		}
	}

	private async upsertDatasetGenerationsByVariantId(
		personId: string,
		items: {
			caption: string;
			s3Key: string | null;
			url: string;
			variantId: string;
		}[],
		options?: { refilledVariantIds?: Set<string> }
	) {
		const personSnapshot = await this.repository.getPersonById(personId);
		if (!personSnapshot) {
			return;
		}

		const existingByVariantId = new Map<string, PersonGenerationRecord>();
		const existingDatasetWithoutVariant: PersonGenerationRecord[] = [];
		for (const generation of personSnapshot.generations) {
			if (generation.metadata.isDatasetPhoto !== true) {
				continue;
			}
			const existingVariantId = readMetadataString(
				generation.metadata,
				"datasetVariantId"
			);
			if (existingVariantId) {
				existingByVariantId.set(existingVariantId, generation);
			} else {
				existingDatasetWithoutVariant.push(generation);
			}
		}

		const incomingVariantIds = new Set(items.map((item) => item.variantId));

		// Drop legacy dataset rows that don't belong to the new variantId set
		// — those came from the old "URL-only" event path or were rejected
		// during the current run. Their S3 objects were cleaned up either by
		// the operator's reject (which goes through `deleteGeneration`) or by
		// the previous training run's cleanup, so we only need to drop the
		// stale DB rows here.
		await this.deleteDatasetGenerationsNotInIncomingSet(
			personId,
			incomingVariantIds,
			existingByVariantId,
			existingDatasetWithoutVariant
		);

		const refilledVariantIds = options?.refilledVariantIds ?? new Set<string>();
		const refilledAt = new Date().toISOString();
		for (const [index, item] of items.entries()) {
			const existing = existingByVariantId.get(item.variantId);
			const isRefill = refilledVariantIds.has(item.variantId);
			const metadata: Record<string, unknown> = {
				datasetCaption: item.caption,
				datasetVariantId: item.variantId,
				isDatasetPhoto: true,
				...(item.s3Key ? { datasetS3Key: item.s3Key } : {}),
				...(isRefill ? { refilledAt } : {}),
			};

			if (existing) {
				if (!this.datasetPhotoItemUpToDate(existing, item)) {
					await this.repository.updateGeneration(existing.id, {
						metadata: { ...existing.metadata, ...metadata },
						previewUrl: item.url,
						sourceUrl: item.url,
					});
				}
				continue;
			}

			await this.repository.createGeneration({
				errorSummary: null,
				id: crypto.randomUUID(),
				mediaType: "image",
				metadata,
				operatorRunId: null,
				operatorScenarioId: null,
				personId,
				previewUrl: item.url,
				prompt: "",
				sourceUrl: item.url,
				status: "ready",
				title: `Dataset photo ${index + 1}`,
			});
		}
	}

	private async cleanupDatasetAfterTraining(personId: string) {
		const person = await this.repository.getPersonById(personId);
		if (!person) {
			return;
		}

		const datasetGenerations = person.generations.filter(
			(generation) => generation.metadata.isDatasetPhoto === true
		);

		for (const generation of datasetGenerations) {
			await this.deleteS3ObjectQuietly(
				this.resolveS3KeyForGeneration(generation)
			);
			await this.repository.deleteGeneration(personId, generation.id);
		}
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
		if (readMetadataString(currentGeneration.metadata, "cancelledAt")) {
			return currentPerson;
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
