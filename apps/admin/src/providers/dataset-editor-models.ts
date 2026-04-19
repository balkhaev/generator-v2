/**
 * Реестр edit-моделей fal.ai, которые dataset-builder может использовать для
 * генерации синтетических вариаций референса.
 *
 * Базовая модель `fal-ai/flux-2/edit` бывала недостаточно консистентной по
 * лицу — отсюда необходимость пробовать альтернативы (Google nano-banana,
 * ByteDance Seedream 4, Qwen-Image-Edit-Plus, Flux Pro Kontext) без правок
 * кода. Для каждой модели зашит адаптер вход/выхода, потому что у моделей
 * разные имена параметров (image_size vs aspect_ratio, image_url vs image_urls
 * и т.д.) и разный набор гиперпараметров (CFG/steps есть не у всех).
 *
 * Все адаптеры стремятся:
 *   - portrait 3:4 кадрирование (или ближайший аналог),
 *   - один результат за вызов (мы сами делаем retries и собираем датасет),
 *   - safety-чекер выключен/максимально лояльный, иначе модели могут отказывать
 *     на портретных edit-ах.
 */

export interface DatasetEditorModelDescriptor {
	/** Человекочитаемое описание для admin UI. */
	description: string;
	/** Уникальный id (он же fal.ai endpoint). */
	id: string;
	/** Короткое имя для UI. */
	label: string;
	/** Поддерживается ли negative_prompt у этой модели. */
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
	extractImageUrl(result: Record<string, unknown>): string | null;
}

const NEGATIVE_PROMPT_FALLBACK_HINT =
	"avoid changing the face, identity, or facial features";

function extractFirstImageUrl(result: Record<string, unknown>): string | null {
	const images = result.images as Array<{ url?: string }> | undefined;
	return images?.[0]?.url ?? null;
}

const flux2Edit: DatasetEditorModelAdapter = {
	descriptor: {
		description:
			"Базовая модель. Быстрая, дешёвая, но иногда дрейфит лицо на 3/4 ракурсах.",
		id: "fal-ai/flux-2/edit",
		label: "FLUX.2 Edit",
		supportsNegativePrompt: true,
	},
	buildRequestBody({ imageUrl, negativePrompt, prompt }) {
		return {
			enable_prompt_expansion: false,
			guidance_scale: 1.8,
			image_size: "portrait_4_3",
			image_urls: [imageUrl],
			negative_prompt: negativePrompt,
			num_images: 1,
			num_inference_steps: 36,
			output_format: "jpeg",
			prompt,
		};
	},
	extractImageUrl: extractFirstImageUrl,
};

const nanoBananaEdit: DatasetEditorModelAdapter = {
	descriptor: {
		description:
			"Google Gemini 2.5 Flash Image (nano-banana). Лучшая identity-consistency на портретах, но дороже и без CFG/steps/negative_prompt.",
		id: "fal-ai/nano-banana/edit",
		label: "Nano Banana (Gemini 2.5 Flash Image)",
		supportsNegativePrompt: false,
	},
	buildRequestBody({ imageUrl, negativePrompt, prompt }) {
		// nano-banana не принимает negative_prompt — подмешиваем мягкий хинт в
		// конец промпта, чтобы хотя бы уменьшить дрейф черт лица.
		const reinforcedPrompt =
			`${prompt}. ${negativePrompt ? `${NEGATIVE_PROMPT_FALLBACK_HINT}.` : ""}`.trim();
		return {
			aspect_ratio: "3:4",
			image_urls: [imageUrl],
			num_images: 1,
			output_format: "png",
			prompt: reinforcedPrompt,
		};
	},
	extractImageUrl: extractFirstImageUrl,
};

const seedreamV4Edit: DatasetEditorModelAdapter = {
	descriptor: {
		description:
			"ByteDance Seedream 4 Edit. Отличный баланс identity и качества кожи, нативно понимает edit-инструкции.",
		id: "fal-ai/bytedance/seedream/v4/edit",
		label: "Seedream 4 Edit",
		supportsNegativePrompt: false,
	},
	buildRequestBody({ imageUrl, prompt }) {
		return {
			enable_safety_checker: false,
			enhance_prompt_mode: "standard",
			image_size: "portrait_4_3",
			image_urls: [imageUrl],
			num_images: 1,
			prompt,
		};
	},
	extractImageUrl: extractFirstImageUrl,
};

const qwenImageEditPlus: DatasetEditorModelAdapter = {
	descriptor: {
		description:
			"Qwen-Image-Edit-Plus. Поддерживает negative_prompt и CFG, выдаёт стабильное лицо при guidance≈4.",
		id: "fal-ai/qwen-image-edit-plus",
		label: "Qwen-Image-Edit-Plus",
		supportsNegativePrompt: true,
	},
	buildRequestBody({ imageUrl, negativePrompt, prompt }) {
		return {
			acceleration: "regular",
			enable_safety_checker: false,
			guidance_scale: 4,
			image_size: "portrait_4_3",
			image_urls: [imageUrl],
			negative_prompt: negativePrompt,
			num_images: 1,
			num_inference_steps: 50,
			output_format: "jpeg",
			prompt,
		};
	},
	extractImageUrl: extractFirstImageUrl,
};

const fluxProKontext: DatasetEditorModelAdapter = {
	descriptor: {
		description:
			"FLUX Pro Kontext. Высокое качество и identity, но принимает только одно входное фото и один CFG-параметр.",
		id: "fal-ai/flux-pro/kontext",
		label: "FLUX Pro Kontext",
		supportsNegativePrompt: false,
	},
	buildRequestBody({ imageUrl, prompt }) {
		return {
			aspect_ratio: "3:4",
			guidance_scale: 3.5,
			image_url: imageUrl,
			num_images: 1,
			output_format: "jpeg",
			prompt,
			safety_tolerance: "5",
		};
	},
	extractImageUrl: (result) => {
		const single = result.image as { url?: string } | undefined;
		if (single?.url) {
			return single.url;
		}
		return extractFirstImageUrl(result);
	},
};

const ADAPTERS: readonly DatasetEditorModelAdapter[] = [
	flux2Edit,
	nanoBananaEdit,
	seedreamV4Edit,
	qwenImageEditPlus,
	fluxProKontext,
] as const;

export const DEFAULT_DATASET_EDITOR_MODEL_ID = flux2Edit.descriptor.id;

export const DATASET_EDITOR_MODEL_DESCRIPTORS: readonly DatasetEditorModelDescriptor[] =
	ADAPTERS.map((a) => a.descriptor);

export function getDatasetEditorModelAdapter(
	modelId: string | null | undefined
): DatasetEditorModelAdapter {
	if (!modelId) {
		return flux2Edit;
	}
	const match = ADAPTERS.find((a) => a.descriptor.id === modelId);
	return match ?? flux2Edit;
}

export function isKnownDatasetEditorModelId(value: unknown): value is string {
	return (
		typeof value === "string" && ADAPTERS.some((a) => a.descriptor.id === value)
	);
}
