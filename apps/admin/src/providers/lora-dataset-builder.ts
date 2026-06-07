/**
 * Общий dataset-builder для LoRA-тренировок: генерирует синтетические вариации
 * через выбранную Replicate image-edit модель (см. dataset-editor-models.ts),
 * миксует с дубликатами оригинального референса и пакует в zip с captions.
 * Используется runpod-runner-ами, чтобы dataset prep не зависел от провайдера
 * тренировки.
 */

import { setTimeout as sleep } from "node:timers/promises";
import {
	downloadImageAsset,
	type S3StorageConfig,
	uploadObjectToS3,
} from "@generator/storage";
import {
	DEFAULT_DATASET_EDITOR_MODEL_ID,
	getDatasetEditorModelAdapter,
} from "@/providers/dataset-editor-models";
import { runReplicateImageEdit } from "@/providers/replicate-image-edit";

/**
 * @deprecated используйте `DEFAULT_DATASET_EDITOR_MODEL_ID` из
 * `dataset-editor-models.ts`. Оставлено как алиас для обратной совместимости.
 */
export const FLUX_REFERENCE_EDIT_MODEL = DEFAULT_DATASET_EDITOR_MODEL_ID;
export const DEFAULT_DATASET_POLL_MS = 5000;
export const DEFAULT_DATASET_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

const fileExtensionPattern = /\.[^.]+$/u;

/**
 * Анти-дрейф для лица. Передаётся в адаптеры моделей; те, что не поддерживают
 * `negative_prompt` (nano-banana, seedream, flux-pro/kontext), обычно
 * подмешивают мягкий хинт в конец основного промпта или игнорируют значение.
 */
export const IDENTITY_NEGATIVE_PROMPT =
	"different person, different face, altered identity, swapped face, plastic surgery look, doll face, cartoon, anime, distorted face, asymmetric face, melted features, blurry face, deformed eyes, extra fingers";

interface ReferenceVariant {
	caption: string;
	prompt: string;
}

interface OriginalPhotoSlot {
	caption: string;
}

const ORIGINAL_PHOTO_SLOTS = [
	{ caption: "candid reference photograph" },
	{ caption: "natural reference portrait" },
	{ caption: "casual reference photo, natural daylight" },
	{ caption: "personal reference snapshot" },
	{ caption: "honest unretouched reference photograph" },
	{ caption: "everyday reference portrait, indoor light" },
] as const satisfies readonly OriginalPhotoSlot[];

const REFERENCE_DATASET_VARIANTS: readonly ReferenceVariant[] = [
	{
		caption:
			"close-up beauty headshot, soft window light, neutral grey backdrop, eyes to camera, relaxed expression",
		prompt:
			"close-up beauty headshot, soft diffused north-window light, neutral grey backdrop, eyes to camera, relaxed neutral expression",
	},
	{
		caption:
			"medium outdoor portrait, golden hour, blurred park background, plain top, eyes to camera",
		prompt:
			"medium outdoor portrait, warm golden hour sunlight, blurred park greenery in the background, plain crew neck top, eyes to camera, relaxed neutral expression",
	},
	{
		caption:
			"half-body urban portrait, overcast soft daylight, blurred street background, plain dark sweater, eyes to camera",
		prompt:
			"half-body environmental portrait, modern urban sidewalk fully blurred in the background, overcast soft daylight, plain dark sweater, eyes to camera, neutral expression",
	},
	{
		caption:
			"editorial half-body shot, clean white studio backdrop, soft beauty dish lighting, plain top, eyes to camera",
		prompt:
			"editorial half-body portrait, clean white seamless studio backdrop, soft beauty dish lighting from front, plain neutral top, eyes to camera, neutral relaxed expression",
	},
	{
		caption:
			"seated indoor portrait, warm ambient lamp light, plain interior background, plain knit top, eyes to camera",
		prompt:
			"relaxed seated indoor portrait, warm ambient lamp light, softly blurred plain interior background, plain knit top, eyes to camera, calm gentle expression",
	},
	{
		caption:
			"interior half-body portrait, warm tungsten light, plain neutral background, plain dark top, eyes to camera",
		prompt:
			"half-body interior portrait, soft warm tungsten lighting, plain neutral background, simple dark top, eyes to camera, gentle natural expression",
	},
	{
		caption:
			"high-key headshot, fresh morning daylight, no makeup, plain white tee, slight closed-mouth smile",
		prompt:
			"high-key headshot in fresh morning daylight, plain off-white background, natural untouched skin with no visible makeup, plain white t-shirt, slight closed-mouth smile, eyes to camera",
	},
	{
		caption:
			"half-body autumn outdoor portrait, soft overcast light, plain knit sweater, eyes to camera",
		prompt:
			"half-body outdoor autumn portrait, soft overcast diffuse light, blurred warm earthy background, plain knit sweater, eyes to camera, neutral expression",
	},
	{
		caption:
			"corporate headshot, medium grey background, soft frontal clamshell lighting, plain dark shirt, friendly closed-mouth smile",
		prompt:
			"professional corporate headshot, solid medium grey backdrop, soft frontal clamshell lighting, plain dark collared shirt, friendly closed-mouth smile, eyes to camera",
	},
	{
		caption:
			"cafe half-body portrait, soft window daylight, blurred wooden interior, plain top, eyes to camera",
		prompt:
			"half-body cafe portrait, soft daylight from a large window, warm blurred wooden interior, plain neutral top, eyes to camera, neutral relaxed expression",
	},
	{
		caption:
			"bright kitchen half-body shot, soft morning daylight, plain top, eyes to camera",
		prompt:
			"half-body shot in a bright modern kitchen, soft morning daylight from a large window, blurred plain interior background, plain top, eyes to camera, neutral expression",
	},
	{
		caption:
			"tight frontal headshot, off-white background, soft frontal beauty lighting, neutral relaxed expression, sharp focus on face",
		prompt:
			"tight frontal headshot of the face and shoulders, plain off-white seamless background, soft frontal beauty lighting, eye-level camera, neutral relaxed expression, both eyes clearly visible to camera, sharp focus on face",
	},
	{
		caption:
			"close-up headshot, soft pastel pink seamless backdrop, soft frontal softbox, plain cream silk top, neutral expression",
		prompt:
			"close-up beauty headshot, soft pastel pink seamless backdrop, soft frontal softbox lighting, plain cream silk shell top, eye-level camera, neutral relaxed expression, both eyes to camera",
	},
	{
		caption:
			"close-up headshot, cool blue-grey backdrop, soft north-window light, plain charcoal crewneck top, neutral expression",
		prompt:
			"close-up beauty headshot, cool blue-grey seamless backdrop, soft diffused north-window light, plain charcoal crewneck top, eye-level camera, neutral relaxed expression, both eyes to camera",
	},
	{
		caption:
			"half-body portrait, warm beige seamless backdrop, neutral softbox key plus fill, plain camel cashmere sweater, gentle closed-mouth smile",
		prompt:
			"half-body portrait, warm beige seamless backdrop, neutral softbox key plus soft fill, plain camel cashmere sweater, eye-level camera, gentle closed-mouth smile, eyes to camera",
	},
	{
		caption:
			"close-up portrait, soft sage green interior wall, soft diffused window light, plain olive linen blouse, neutral expression",
		prompt:
			"close-up portrait, softly blurred sage green interior wall, soft diffused window light, plain olive linen blouse, eye-level camera, neutral relaxed expression, eyes to camera",
	},
	{
		caption:
			"half-body outdoor portrait, neutral concrete wall, soft overcast daylight, plain navy crewneck top, neutral expression",
		prompt:
			"half-body outdoor portrait against a smoothly blurred neutral concrete wall, soft overcast daylight, plain navy crewneck top, eye-level camera, neutral relaxed expression, eyes to camera",
	},
	{
		caption:
			"close-up headshot, dusty rose backdrop, large frontal softbox, plain ivory cotton tee, soft closed-mouth smile",
		prompt:
			"close-up beauty headshot, dusty rose seamless backdrop, large frontal softbox lighting, plain ivory cotton tee, eye-level camera, soft closed-mouth smile, eyes to camera",
	},
	{
		caption:
			"shoulder-up frontal portrait, off-white seamless, soft daylight LED panel, plain heather grey tee, fresh neutral expression",
		prompt:
			"shoulder-up frontal portrait, plain off-white seamless backdrop, soft daylight-balanced LED panel from front, plain heather grey cotton tee, eye-level camera, fresh neutral expression, eyes to camera",
	},
] as const;

export const ORIGINAL_PHOTO_DUPLICATES = ORIGINAL_PHOTO_SLOTS.length;
export const REFERENCE_VARIANT_COUNT = REFERENCE_DATASET_VARIANTS.length;
export const TOTAL_DATASET_COUNT =
	REFERENCE_VARIANT_COUNT + ORIGINAL_PHOTO_DUPLICATES;

const FEMALE_PATTERNS =
	/\b(woman|girl|female|женщина|девушка|девочка|she|her)\b/i;
const MALE_PATTERNS = /\b(man|boy|male|мужчина|парень|мальчик|he|his)\b/i;

const IDENTITY_PRESERVATION_HINT =
	"exact same face and identity as the reference, identical facial features, identical eyes nose and mouth, identical face shape, photorealistic skin, accurate likeness, do not alter the face";

const IDENTITY_PROMPT_PREFIX =
	"same exact person from the reference image, identical face and identity";

export function inferGenderHint(description?: string | null): string | null {
	if (!description) {
		return null;
	}
	if (FEMALE_PATTERNS.test(description)) {
		return "woman";
	}
	if (MALE_PATTERNS.test(description)) {
		return "man";
	}
	return null;
}

export function sanitizeSegment(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/giu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 64);
}

/**
 * Builds the LoRA trigger word. Префиксуем `ohwx` (классический rare token из
 * DreamBooth), чтобы базовая модель не имела с ним ассоциаций — вся идентичность
 * приходится на LoRA, а не на «угаданные» trainer-ом черты под имя персоны.
 */
export function buildDefaultTriggerWord(slug: string): string {
	const sanitized = sanitizeSegment(slug).replace(/-/gu, "_");
	const stem = sanitized.length > 0 ? sanitized : "person";
	return `ohwx_${stem}`.slice(0, 60);
}

function buildVariantPrompt(input: {
	referencePrompt?: string | null;
	variant: ReferenceVariant;
}): string {
	const identitySuffix = input.referencePrompt?.trim().length
		? `${input.referencePrompt.trim()}, ${IDENTITY_PRESERVATION_HINT}`
		: IDENTITY_PRESERVATION_HINT;
	return `${IDENTITY_PROMPT_PREFIX}, ${input.variant.prompt}, ${identitySuffix}`;
}

function buildVariantCaption(input: {
	genderHint: string | null;
	triggerWord: string;
	variant: ReferenceVariant;
}): string {
	const subject = input.genderHint
		? `${input.triggerWord} ${input.genderHint}`
		: input.triggerWord;
	return `a photo of ${subject}, ${input.variant.caption}`;
}

function buildOriginalPhotoCaption(input: {
	genderHint: string | null;
	slot: OriginalPhotoSlot;
	triggerWord: string;
}): string {
	const subject = input.genderHint
		? `${input.triggerWord} ${input.genderHint}`
		: input.triggerWord;
	return `a photo of ${subject}, ${input.slot.caption}`;
}

async function generateReferenceImageOnce(
	apiKey: string,
	imageUrl: string,
	prompt: string,
	editorModelId: string
): Promise<string | null> {
	const adapter = getDatasetEditorModelAdapter(editorModelId);
	const output = await runReplicateImageEdit({
		apiToken: apiKey,
		input: adapter.buildRequestBody({
			imageUrl,
			negativePrompt: IDENTITY_NEGATIVE_PROMPT,
			prompt,
		}),
		model: adapter.replicateModel,
		pollMs: DEFAULT_DATASET_POLL_MS,
		timeoutMs: DEFAULT_DATASET_TIMEOUT_MS,
	});
	return adapter.extractImageUrl(output);
}

/**
 * Generate a single reference variation through the configured Replicate editor
 * model with N retries. The exact request shape per model lives in
 * dataset-editor-models.ts; here we just glue retries + polling.
 *
 * `apiKey` is the Replicate API token.
 */
export async function generateReferenceImage(
	apiKey: string,
	imageUrl: string,
	prompt: string,
	editorModelId: string = DEFAULT_DATASET_EDITOR_MODEL_ID
): Promise<string> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
		try {
			const url = await generateReferenceImageOnce(
				apiKey,
				imageUrl,
				prompt,
				editorModelId
			);
			if (url) {
				return url;
			}
			lastError = new Error(`${editorModelId} returned no images`);
		} catch (error) {
			lastError =
				error instanceof Error
					? error
					: new Error(`${editorModelId} request failed`);
		}
		if (attempt < DEFAULT_RETRY_ATTEMPTS) {
			await sleep(DEFAULT_RETRY_DELAY_MS);
		}
	}
	throw lastError ?? new Error(`${editorModelId} failed after retries`);
}

export interface GeneratedReference {
	caption: string;
	url: string;
}

export interface ZipFileEntry {
	data: Uint8Array;
	name: string;
}

export interface ReferenceDatasetResult {
	defaultCaption: string;
	generatedReferences: GeneratedReference[];
	zipFiles: ZipFileEntry[];
}

export interface BuildReferenceDatasetInput {
	/** Replicate API token. */
	apiKey: string;
	/**
	 * Replicate image-edit model id, e.g. `qwen/qwen-image-edit`. Если не
	 * передан — используется DEFAULT_DATASET_EDITOR_MODEL_ID. Каждый runner
	 * резолвит актуальный id из admin runtime-config непосредственно перед
	 * вызовом, чтобы смена модели применялась к новым job-ам без рестарта.
	 */
	editorModelId?: string;
	genderHint: string | null;
	onStart?: () => Promise<void>;
	onVariantGenerated?: (info: {
		generated: GeneratedReference[];
		index: number;
		total: number;
	}) => Promise<void>;
	referencePhotoUrl: string;
	referencePrompt?: string | null;
	triggerWord: string;
}

/**
 * Generate the full reference dataset:
 *   - 19 синтетических вариаций через Replicate image-edit модель
 *   - 6 копий оригинала с разными captions (anchor для лица)
 * Возвращает массив zip-файлов (image bytes + .txt captions) и default caption,
 * который провайдер тренировки кладёт в свой config (z-image-trainer
 * `default_caption`, ai-toolkit dataset default).
 */
export async function buildReferenceDataset(
	input: BuildReferenceDatasetInput
): Promise<ReferenceDatasetResult> {
	await input.onStart?.();

	const generatedReferences: GeneratedReference[] = [];
	for (const variant of REFERENCE_DATASET_VARIANTS) {
		const prompt = buildVariantPrompt({
			referencePrompt: input.referencePrompt,
			variant,
		});
		const caption = buildVariantCaption({
			genderHint: input.genderHint,
			triggerWord: input.triggerWord,
			variant,
		});
		const url = await generateReferenceImage(
			input.apiKey,
			input.referencePhotoUrl,
			prompt,
			input.editorModelId
		);
		generatedReferences.push({ caption, url });
		await input.onVariantGenerated?.({
			generated: generatedReferences,
			index: generatedReferences.length,
			total: REFERENCE_VARIANT_COUNT,
		});
	}

	const refPhoto = await downloadImageAsset(input.referencePhotoUrl);
	const generatedImages = await Promise.all(
		generatedReferences.map(async (entry, index) => {
			const image = await downloadImageAsset(entry.url);
			return {
				caption: entry.caption,
				data: image.data,
				name: `${String(index + ORIGINAL_PHOTO_DUPLICATES).padStart(3, "0")}${image.extension}`,
			};
		})
	);

	const zipFiles: ZipFileEntry[] = [];
	for (const [slotIndex, slot] of ORIGINAL_PHOTO_SLOTS.entries()) {
		const baseName = String(slotIndex).padStart(3, "0");
		zipFiles.push({
			name: `${baseName}${refPhoto.extension}`,
			data: refPhoto.data,
		});
		zipFiles.push({
			name: `${baseName}.txt`,
			data: new TextEncoder().encode(
				buildOriginalPhotoCaption({
					genderHint: input.genderHint,
					slot,
					triggerWord: input.triggerWord,
				})
			),
		});
	}

	for (const img of generatedImages) {
		zipFiles.push({ name: img.name, data: img.data });
		zipFiles.push({
			name: img.name.replace(fileExtensionPattern, ".txt"),
			data: new TextEncoder().encode(img.caption),
		});
	}

	const defaultCaption = buildOriginalPhotoCaption({
		genderHint: input.genderHint,
		slot: ORIGINAL_PHOTO_SLOTS[0],
		triggerWord: input.triggerWord,
	});

	return {
		defaultCaption,
		generatedReferences,
		zipFiles,
	};
}

/**
 * `variant-NN` → synthetic flux-2/edit variation, NN is the index inside
 * `REFERENCE_DATASET_VARIANTS`. `original-NN` → captioned duplicate of the
 * source reference photo, NN indexes `ORIGINAL_PHOTO_SLOTS`. The format is
 * intentionally stable: persons-service stores it on every dataset
 * `PersonGenerationRecord` and uses it as the upsert key when admin worker
 * (re)publishes a slot.
 */
export const ORIGINAL_VARIANT_ID_PREFIX = "original-";
export const SYNTHETIC_VARIANT_ID_PREFIX = "variant-";

function buildOriginalVariantId(index: number): string {
	return `${ORIGINAL_VARIANT_ID_PREFIX}${String(index).padStart(2, "0")}`;
}

function buildSyntheticVariantId(index: number): string {
	return `${SYNTHETIC_VARIANT_ID_PREFIX}${String(index).padStart(2, "0")}`;
}

function parseVariantIndex(variantId: string, prefix: string): number | null {
	if (!variantId.startsWith(prefix)) {
		return null;
	}
	const raw = variantId.slice(prefix.length);
	const index = Number.parseInt(raw, 10);
	return Number.isFinite(index) ? index : null;
}

/**
 * One ready-to-zip dataset photo. Emitted incrementally by the approval-flow
 * dataset prep pipeline so persons-service can upsert the corresponding
 * `PersonGenerationRecord` slot the moment the photo lands in S3 (instead of
 * waiting for the whole batch).
 *
 *   - `url` is the public S3 URL the operator sees in persons-web
 *   - `s3Key` is the same object expressed as a key (used for cleanup
 *     after the LoRA is published or the slot is rejected)
 *   - `variantId` is the stable slot identifier (see above)
 *   - `caption` is the per-photo caption baked into the zip alongside it
 */
export interface PreparedDatasetPhoto {
	caption: string;
	s3Key: string | null;
	url: string;
	variantId: string;
}

export type SeedDatasetPhoto = PreparedDatasetPhoto;

const leadingDotPattern = /^\./u;

/**
 * Best-effort mime guess from filename extension. We only ever see the half a
 * dozen image types the editor returns, so a tiny lookup beats pulling in a
 * full mime DB for one upload call.
 */
function guessImageContentType(extension: string): string {
	const normalized = extension.toLowerCase().replace(leadingDotPattern, "");
	if (normalized === "png") {
		return "image/png";
	}
	if (normalized === "webp") {
		return "image/webp";
	}
	if (normalized === "gif") {
		return "image/gif";
	}
	return "image/jpeg";
}

interface DatasetPhotoUploadInput {
	bytes: Uint8Array;
	extension: string;
	fallbackUrl: string;
	personId: string;
	s3Config?: S3StorageConfig;
	trainingRunId: string;
	variantId: string;
}

/**
 * Uploads one dataset photo to S3 under a deterministic key derived from
 * (personId, trainingRunId, variantId). When `s3Config` is missing we
 * gracefully fall through and return the original ephemeral URL — that path
 * exists for tests and dry-runs where S3 isn't wired up.
 */
async function uploadDatasetPhoto(
	input: DatasetPhotoUploadInput
): Promise<{ s3Key: string | null; url: string }> {
	if (!input.s3Config) {
		return { s3Key: null, url: input.fallbackUrl };
	}
	const safeVariant = sanitizeSegment(input.variantId) || input.variantId;
	const safeExtension = input.extension.startsWith(".")
		? input.extension
		: `.${input.extension}`;
	const key = `persons/${sanitizeSegment(input.personId)}/datasets/${sanitizeSegment(input.trainingRunId)}/${safeVariant}${safeExtension}`;
	const uploaded = await uploadObjectToS3(
		{
			contentType: guessImageContentType(safeExtension),
			data: input.bytes,
			key,
			tmpPrefix: "dataset-photo",
		},
		input.s3Config
	);
	return { s3Key: uploaded.key, url: uploaded.url };
}

interface GenerateSingleVariantInput {
	apiKey: string;
	editorModelId?: string;
	genderHint: string | null;
	personId: string;
	referencePhotoUrl: string;
	referencePrompt?: string | null;
	s3Config?: S3StorageConfig;
	trainingRunId: string;
	triggerWord: string;
	variantId: string;
}

/**
 * Generates (or, for `original-*` slots, copies) a single dataset photo and
 * uploads it to S3. The result is the canonical descriptor the rest of the
 * pipeline (admin worker → persons-service → persons-web) keys off of.
 *
 * For synthetic slots this calls the configured Replicate editor model with the
 * variant's preset prompt. For original slots it just re-uploads the source
 * reference photo with the slot-specific caption — that's how we anchor the
 * trainer on the real face without paying for another generation.
 */
export async function generateSingleVariant(
	input: GenerateSingleVariantInput
): Promise<PreparedDatasetPhoto> {
	const editorModelId = input.editorModelId ?? DEFAULT_DATASET_EDITOR_MODEL_ID;

	const originalIndex = parseVariantIndex(
		input.variantId,
		ORIGINAL_VARIANT_ID_PREFIX
	);
	if (originalIndex !== null) {
		const slot = ORIGINAL_PHOTO_SLOTS[originalIndex];
		if (!slot) {
			throw new Error(
				`Unknown original dataset slot for variantId=${input.variantId}`
			);
		}
		const refPhoto = await downloadImageAsset(input.referencePhotoUrl);
		const uploaded = await uploadDatasetPhoto({
			bytes: refPhoto.data,
			extension: refPhoto.extension,
			fallbackUrl: input.referencePhotoUrl,
			personId: input.personId,
			s3Config: input.s3Config,
			trainingRunId: input.trainingRunId,
			variantId: input.variantId,
		});
		return {
			caption: buildOriginalPhotoCaption({
				genderHint: input.genderHint,
				slot,
				triggerWord: input.triggerWord,
			}),
			s3Key: uploaded.s3Key,
			url: uploaded.url,
			variantId: input.variantId,
		};
	}

	const variantIndex = parseVariantIndex(
		input.variantId,
		SYNTHETIC_VARIANT_ID_PREFIX
	);
	if (variantIndex === null) {
		throw new Error(`Unknown variantId=${input.variantId}`);
	}
	const variant = REFERENCE_DATASET_VARIANTS[variantIndex];
	if (!variant) {
		throw new Error(
			`Unknown synthetic dataset variant for variantId=${input.variantId}`
		);
	}

	const prompt = buildVariantPrompt({
		referencePrompt: input.referencePrompt,
		variant,
	});
	const ephemeralUrl = await generateReferenceImage(
		input.apiKey,
		input.referencePhotoUrl,
		prompt,
		editorModelId
	);
	const generated = await downloadImageAsset(ephemeralUrl);
	const uploaded = await uploadDatasetPhoto({
		bytes: generated.data,
		extension: generated.extension,
		fallbackUrl: ephemeralUrl,
		personId: input.personId,
		s3Config: input.s3Config,
		trainingRunId: input.trainingRunId,
		variantId: input.variantId,
	});
	return {
		caption: buildVariantCaption({
			genderHint: input.genderHint,
			triggerWord: input.triggerWord,
			variant,
		}),
		s3Key: uploaded.s3Key,
		url: uploaded.url,
		variantId: input.variantId,
	};
}

interface PrepareDatasetPhotosInput {
	apiKey: string;
	editorModelId?: string;
	genderHint: string | null;
	onPhotoReady: (photo: PreparedDatasetPhoto) => Promise<void>;
	personId: string;
	referencePhotoUrl: string;
	referencePrompt?: string | null;
	s3Config?: S3StorageConfig;
	seedPhotos?: readonly SeedDatasetPhoto[];
	trainingRunId: string;
	triggerWord: string;
}

function dedupeSeedPhotos(
	seedPhotos: readonly SeedDatasetPhoto[] | undefined
): PreparedDatasetPhoto[] {
	if (!seedPhotos?.length) {
		return [];
	}

	const seenUrls = new Set<string>();
	const seenVariantIds = new Set<string>();
	const photos: PreparedDatasetPhoto[] = [];

	for (const photo of seedPhotos) {
		const url = photo.url.trim();
		const variantId = photo.variantId.trim();
		if (!(url && variantId)) {
			continue;
		}
		if (seenUrls.has(url) || seenVariantIds.has(variantId)) {
			continue;
		}
		seenUrls.add(url);
		seenVariantIds.add(variantId);
		photos.push({
			caption: photo.caption,
			s3Key: photo.s3Key,
			url,
			variantId,
		});
		if (photos.length >= TOTAL_DATASET_COUNT) {
			break;
		}
	}

	return photos;
}

function buildMissingVariantIds(
	seedCount: number,
	usedVariantIds: Set<string>
) {
	const missingCount = Math.max(0, TOTAL_DATASET_COUNT - seedCount);
	const originalIds = Array.from(
		{ length: ORIGINAL_PHOTO_DUPLICATES },
		(_, i) => buildOriginalVariantId(i)
	);
	const syntheticIds = Array.from({ length: REFERENCE_VARIANT_COUNT }, (_, i) =>
		buildSyntheticVariantId(i)
	);
	const defaultOrder = [...originalIds, ...syntheticIds];
	const seedFillOrder = [...syntheticIds, ...originalIds];
	const candidates = seedCount > 0 ? seedFillOrder : defaultOrder;

	return candidates
		.filter((variantId) => !usedVariantIds.has(variantId))
		.slice(0, missingCount);
}

/**
 * Generates the entire dataset photo set (originals first, then synthetic
 * variants) and streams each finished photo through `onPhotoReady` so admin
 * worker can publish a per-slot training event the moment a photo lands in
 * S3. Originals come first because they're cheap and let the operator start
 * reviewing the baseline immediately while flux-2/edit chews through the
 * synthetics.
 */
export async function prepareDatasetPhotos(
	input: PrepareDatasetPhotosInput
): Promise<PreparedDatasetPhoto[]> {
	const photos = dedupeSeedPhotos(input.seedPhotos);
	for (const seedPhoto of photos) {
		await input.onPhotoReady(seedPhoto);
	}

	const usedVariantIds = new Set(photos.map((photo) => photo.variantId));
	const missingVariantIds = buildMissingVariantIds(
		photos.length,
		usedVariantIds
	);

	for (const variantId of missingVariantIds) {
		const photo = await generateSingleVariant({
			apiKey: input.apiKey,
			editorModelId: input.editorModelId,
			genderHint: input.genderHint,
			personId: input.personId,
			referencePhotoUrl: input.referencePhotoUrl,
			referencePrompt: input.referencePrompt,
			s3Config: input.s3Config,
			trainingRunId: input.trainingRunId,
			triggerWord: input.triggerWord,
			variantId,
		});
		photos.push(photo);
		await input.onPhotoReady(photo);
	}

	return photos;
}

export interface ApprovedDatasetItemDescriptor {
	caption: string;
	url: string;
	variantId: string;
}

export interface AssembledDatasetResult {
	defaultCaption: string;
	referenceImageUrls: string[];
	zipFiles: ZipFileEntry[];
}

interface AssembleDatasetZipFromItemsInput {
	defaultCaption: string;
	items: readonly ApprovedDatasetItemDescriptor[];
}

/**
 * Packs the operator-approved dataset (already uploaded to S3 by the prep
 * stage) into a flat zip layout the trainer expects: one image + one .txt
 * caption per slot. Filenames are derived from the slot's position in the
 * approved list so the trainer sees a stable ordering, but originals are
 * intentionally placed first to mirror the legacy zip layout produced by
 * `buildReferenceDataset`.
 */
export async function assembleDatasetZipFromItems(
	input: AssembleDatasetZipFromItemsInput
): Promise<AssembledDatasetResult> {
	const ordered = [...input.items].sort((a, b) => {
		const aIsOriginal = a.variantId.startsWith(ORIGINAL_VARIANT_ID_PREFIX);
		const bIsOriginal = b.variantId.startsWith(ORIGINAL_VARIANT_ID_PREFIX);
		if (aIsOriginal !== bIsOriginal) {
			return aIsOriginal ? -1 : 1;
		}
		return a.variantId.localeCompare(b.variantId);
	});

	const zipFiles: ZipFileEntry[] = [];
	const referenceImageUrls: string[] = [];
	for (const [index, item] of ordered.entries()) {
		const image = await downloadImageAsset(item.url);
		const baseName = String(index).padStart(3, "0");
		zipFiles.push({ data: image.data, name: `${baseName}${image.extension}` });
		zipFiles.push({
			data: new TextEncoder().encode(item.caption),
			name: `${baseName}.txt`,
		});
		referenceImageUrls.push(item.url);
	}

	return {
		defaultCaption: input.defaultCaption,
		referenceImageUrls,
		zipFiles,
	};
}
