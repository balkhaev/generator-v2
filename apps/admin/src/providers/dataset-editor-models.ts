/**
 * Реестр Replicate image-edit моделей для dataset-prep пайплайна LoRA-тренировки.
 *
 * Каждая модель описывается адаптером: как собрать `input` для Replicate
 * official-модели (`owner/name`) и как достать URL результата из `output`.
 * Раньше тут были fal.ai edit-эндпоинты — после выпиливания fal датасет-prep
 * полностью уходит на Replicate (см. `replicate-image-edit.ts`).
 */

const NEGATIVE_PROMPT_FALLBACK_HINT =
	"avoid changing the face, identity, or facial features";

export interface DatasetEditorModelDescriptor {
	description: string;
	/** Стабильный id (== Replicate model slug `owner/name`). */
	id: string;
	label: string;
	supportsNegativePrompt: boolean;
}

export interface BuildEditorRequestInput {
	imageUrl: string;
	negativePrompt: string;
	prompt: string;
}

export interface DatasetEditorModelAdapter {
	buildRequestBody(input: BuildEditorRequestInput): Record<string, unknown>;
	descriptor: DatasetEditorModelDescriptor;
	extractImageUrl(output: unknown): string | null;
	/** Replicate official model slug, e.g. `qwen/qwen-image-edit`. */
	replicateModel: string;
}

/**
 * Replicate `output` для image-edit моделей бывает строкой-URL, массивом
 * строк-URL или объектом `{ url }`. Берём первый валидный URL.
 */
function extractFirstReplicateUrl(output: unknown): string | null {
	if (typeof output === "string" && output.length > 0) {
		return output;
	}
	if (Array.isArray(output)) {
		for (const entry of output) {
			const url = extractFirstReplicateUrl(entry);
			if (url) {
				return url;
			}
		}
		return null;
	}
	if (output && typeof output === "object") {
		const url = (output as { url?: unknown }).url;
		if (typeof url === "string" && url.length > 0) {
			return url;
		}
	}
	return null;
}

/** Порядок = порядок в селекте админки. */
const DATASET_EDITOR_ENTRIES: readonly DatasetEditorModelAdapter[] = [
	{
		descriptor: {
			description:
				"Qwen-Image-Edit (Replicate). NSFW-friendly, держит identity на портретах, поддерживает отключение safety-checker. Дефолт.",
			id: "qwen/qwen-image-edit",
			label: "Qwen Image Edit",
			supportsNegativePrompt: false,
		},
		replicateModel: "qwen/qwen-image-edit",
		buildRequestBody({ imageUrl, prompt }) {
			return {
				aspect_ratio: "match_input_image",
				disable_safety_checker: true,
				go_fast: true,
				image: imageUrl,
				output_format: "jpg",
				output_quality: 95,
				prompt,
			};
		},
		extractImageUrl: extractFirstReplicateUrl,
	},
	{
		descriptor: {
			description:
				"FLUX.1 Kontext Pro (Replicate). Высокое качество и сильная identity-consistency, но один CFG-параметр и платнее.",
			id: "black-forest-labs/flux-kontext-pro",
			label: "FLUX Kontext Pro",
			supportsNegativePrompt: false,
		},
		replicateModel: "black-forest-labs/flux-kontext-pro",
		buildRequestBody({ imageUrl, negativePrompt, prompt }) {
			const reinforcedPrompt = negativePrompt
				? `${prompt}. ${NEGATIVE_PROMPT_FALLBACK_HINT}.`
				: prompt;
			return {
				aspect_ratio: "match_input_image",
				input_image: imageUrl,
				output_format: "jpg",
				prompt: reinforcedPrompt,
				prompt_upsampling: false,
				safety_tolerance: 6,
			};
		},
		extractImageUrl: extractFirstReplicateUrl,
	},
];

const firstDatasetEntry = DATASET_EDITOR_ENTRIES[0];
if (!firstDatasetEntry) {
	throw new Error("DATASET_EDITOR_ENTRIES must not be empty");
}
const DEFAULT_DATASET_ENTRY = firstDatasetEntry;

export const DEFAULT_DATASET_EDITOR_MODEL_ID =
	DEFAULT_DATASET_ENTRY.descriptor.id;

export const DATASET_EDITOR_MODEL_DESCRIPTORS: readonly DatasetEditorModelDescriptor[] =
	DATASET_EDITOR_ENTRIES.map((e) => e.descriptor);

const ADAPTER_BY_ID = new Map(
	DATASET_EDITOR_ENTRIES.map((e) => [e.descriptor.id, e])
);

export function getDatasetEditorModelAdapter(
	modelId: string | null | undefined
): DatasetEditorModelAdapter {
	if (!modelId) {
		return DEFAULT_DATASET_ENTRY;
	}
	return ADAPTER_BY_ID.get(modelId) ?? DEFAULT_DATASET_ENTRY;
}

export function isKnownDatasetEditorModelId(value: unknown): value is string {
	return typeof value === "string" && ADAPTER_BY_ID.has(value);
}
