/**
 * Canonical registry of base models used across the platform.
 *
 * One source of truth for: LoRA registry (admin-web), workflow taxonomy
 * (studio-web compose), Civitai meta auto-detection, and DB filtering.
 *
 * Adding a new model:
 *   1. Append an entry to `BASE_MODELS` (no DB migration required — column is `text`).
 *   2. Add Civitai aliases (case-insensitive substring match on normalized value).
 */

export type BaseModelFamily =
	| "flux"
	| "qwen"
	| "sdxl"
	| "sd"
	| "z-image"
	| "image-other"
	| "video"
	| "audio"
	| "other";

export type BaseModelModality = "image" | "video" | "audio";

export interface BaseModelEntry {
	/** Civitai `baseModel` strings (case-insensitive substring match after normalization). */
	civitaiAliases: readonly string[];
	family: BaseModelFamily;
	id: string;
	label: string;
	modality: BaseModelModality;
}

// Registry mirrors the model coverage of ostris/ai-toolkit (image/edit/video/
// audio/experimental sections of its README). We intentionally do NOT carry
// legacy Civitai bases (SD 2/3/3.5, Pony/Illustrious/NoobAI, Hunyuan/CogVideoX/
// Mochi, Kolors, AuraFlow, Stable Cascade, PixArt, etc.) — we only need bases
// we can actually train and run LoRAs against. Civitai alias matching prefers
// longer patterns, so version-specific entries beat their generic counterparts.
export const BASE_MODELS = [
	// Flux family
	{
		id: "flux",
		label: "Flux.1",
		family: "flux",
		modality: "image",
		civitaiAliases: [
			"flux.1 d",
			"flux.1 s",
			"flux 1 d",
			"flux 1 s",
			"flux.1d",
			"flux.1s",
			"flux dev",
			"flux schnell",
			"flux",
		],
	},
	{
		id: "flux-kontext",
		label: "Flux.1 Kontext",
		family: "flux",
		modality: "image",
		civitaiAliases: ["flux.1 kontext", "flux kontext", "kontext"],
	},
	{
		id: "flux-2",
		label: "Flux.2",
		family: "flux",
		modality: "image",
		civitaiAliases: ["flux.2 dev", "flux 2 dev", "flux.2", "flux 2", "flux2"],
	},
	{
		id: "flux-2-klein-4b",
		label: "Flux.2 Klein 4B",
		family: "flux",
		modality: "image",
		civitaiAliases: [
			"flux.2 klein 4b",
			"flux 2 klein 4b",
			"flux2 klein 4b",
			"flux.2-klein-base-4b",
		],
	},
	{
		id: "flux-2-klein-9b",
		label: "Flux.2 Klein 9B",
		family: "flux",
		modality: "image",
		civitaiAliases: [
			"flux.2 klein 9b",
			"flux 2 klein 9b",
			"flux2 klein 9b",
			"flux.2-klein-base-9b",
		],
	},

	// Qwen-Image family
	{
		id: "qwen-image",
		label: "Qwen-Image",
		family: "qwen",
		modality: "image",
		civitaiAliases: ["qwen image", "qwen-image", "qwenimage"],
	},
	{
		id: "qwen-image-2512",
		label: "Qwen-Image 2512",
		family: "qwen",
		modality: "image",
		civitaiAliases: [
			"qwen image 2512",
			"qwen-image 2512",
			"qwen image-2512",
			"qwen-image-2512",
		],
	},
	{
		id: "qwen-image-edit",
		label: "Qwen-Image Edit",
		family: "qwen",
		modality: "image",
		civitaiAliases: ["qwen image edit", "qwen-image-edit"],
	},
	{
		id: "qwen-image-edit-2509",
		label: "Qwen-Image Edit 2509",
		family: "qwen",
		modality: "image",
		civitaiAliases: ["qwen image edit 2509", "qwen-image-edit-2509"],
	},
	{
		id: "qwen-image-edit-2511",
		label: "Qwen-Image Edit 2511",
		family: "qwen",
		modality: "image",
		civitaiAliases: ["qwen image edit 2511", "qwen-image-edit-2511"],
	},

	// SDXL family
	{
		id: "sdxl",
		label: "SDXL",
		family: "sdxl",
		modality: "image",
		civitaiAliases: [
			"sdxl 1.0",
			"sdxl 0.9",
			"sdxl distilled",
			"sdxl turbo",
			"sdxl lightning",
			"sdxl hyper",
			"sdxl",
		],
	},

	// SD 1.5
	{
		id: "sd-1-5",
		label: "SD 1.5",
		family: "sd",
		modality: "image",
		civitaiAliases: [
			"sd 1.5",
			"sd 1.4",
			"sd1.5",
			"stable diffusion 1.5",
			"sd 1.5 lcm",
			"sd 1.5 hyper",
		],
	},

	// Z-Image
	// IMPORTANT: Z-Image (base) and Z-Image Turbo are different distillations
	// (similar to Flux dev vs Flux schnell). LoRAs trained on one are NOT
	// compatible with the other — keep them as separate registry entries.
	{
		id: "z-image-turbo",
		label: "Z-Image Turbo",
		family: "z-image",
		modality: "image",
		civitaiAliases: [
			"z-image turbo",
			"z image turbo",
			"zimage turbo",
			"z-image-turbo",
			"zimageturbo",
		],
	},
	{
		id: "z-image-de-turbo",
		label: "Z-Image De-Turbo",
		family: "z-image",
		modality: "image",
		civitaiAliases: [
			"z-image de-turbo",
			"z image de turbo",
			"zimage de-turbo",
			"z-image-de-turbo",
		],
	},
	{
		id: "z-image",
		label: "Z-Image (base)",
		family: "z-image",
		modality: "image",
		civitaiAliases: ["z-image", "z image", "zimage"],
	},

	// Other modern image models
	{
		id: "hidream",
		label: "HiDream",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["hidream i1", "hidream", "hi-dream", "hi dream"],
	},
	{
		id: "hidream-e1",
		label: "HiDream E1",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["hidream e1", "hi-dream e1", "hi dream e1", "hidream-e1"],
	},
	{
		id: "lumina",
		label: "Lumina",
		family: "image-other",
		modality: "image",
		civitaiAliases: [
			"lumina image 2",
			"lumina-image-2.0",
			"lumina 2",
			"lumina2",
			"lumina",
		],
	},
	{
		id: "chroma",
		label: "Chroma",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["chroma 1", "chroma1", "chroma"],
	},
	{
		id: "zeta-chroma",
		label: "Zeta Chroma",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["zeta chroma", "zeta-chroma"],
	},
	{
		id: "flex-1",
		label: "Flex.1",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["flex.1 alpha", "flex 1 alpha", "flex.1", "flex 1"],
	},
	{
		id: "flex-2",
		label: "Flex.2",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["flex.2 preview", "flex 2 preview", "flex.2", "flex 2"],
	},
	{
		id: "omnigen-2",
		label: "OmniGen2",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["omnigen 2", "omnigen2", "omnigen-2"],
	},
	{
		id: "ernie-image",
		label: "ERNIE-Image",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["ernie image", "ernie-image", "ernieimage"],
	},
	{
		id: "nucleus-image",
		label: "Nucleus-Image",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["nucleus image", "nucleus-image"],
	},

	// Video
	{
		id: "wan",
		label: "Wan 2.1",
		family: "video",
		modality: "video",
		civitaiAliases: [
			"wan video 1.3b",
			"wan video 14b",
			"wan video 2.1",
			"wan video t2v",
			"wan video i2v",
			"wan 2.1 1.3b",
			"wan 2.1 14b",
			"wan 2.1 i2v 14b-480p",
			"wan 2.1 i2v 14b-720p",
			"wan 2.1",
			"wan video",
		],
	},
	{
		id: "wan-2-2",
		label: "Wan 2.2",
		family: "video",
		modality: "video",
		civitaiAliases: [
			"wan video 2.2",
			"wan 2.2",
			"wan 2.2 14b",
			"wan 2.2 i2v 14b",
			"wan 2.2 ti2v 5b",
			"wan video 2.2 ti2v-5b",
			"wan video 2.2 t2v-a14b",
			"wan video 2.2 i2v-a14b",
		],
	},
	{
		id: "wan-2-7",
		label: "Wan 2.7",
		family: "video",
		modality: "video",
		civitaiAliases: [
			"wan 2.7",
			"wan video 2.7",
			"wan 2.7 i2v",
			"wan video 2.7 i2v",
		],
	},
	{
		id: "seedance-1-5-pro",
		label: "Seedance 1.5 Pro",
		family: "video",
		modality: "video",
		civitaiAliases: [
			"seedance",
			"seedance 1.5",
			"seedance 1.5 pro",
			"bytedance seedance",
			"bytedance seedance 1.5",
		],
	},
	{
		id: "ltx-2",
		label: "LTX-2",
		family: "video",
		modality: "video",
		civitaiAliases: ["ltx 2", "ltx-2", "ltxv 2", "ltxv-2"],
	},
	{
		id: "ltx-2-3",
		label: "LTX-2.3",
		family: "video",
		modality: "video",
		civitaiAliases: ["ltx 2.3", "ltx-2.3", "ltxv 2.3", "ltxv 13b"],
	},

	// Audio
	{
		id: "ace-step",
		label: "Ace Step 1.5",
		family: "audio",
		modality: "audio",
		civitaiAliases: ["ace step 1.5", "ace-step 1.5", "acestep 1.5", "ace step"],
	},
	{
		id: "ace-step-xl",
		label: "Ace Step 1.5 XL",
		family: "audio",
		modality: "audio",
		civitaiAliases: [
			"ace step 1.5 xl",
			"acestep v15 xl",
			"acestep-v15-xl",
			"ace step xl",
		],
	},
	{
		id: "voxcpm-2",
		label: "VoxCPM2 (TTS)",
		family: "audio",
		modality: "audio",
		civitaiAliases: ["voxcpm", "voxcpm2", "voxcpm 2"],
	},
	{
		id: "higgs-audio-v3",
		label: "Higgs Audio v3 (TTS)",
		family: "audio",
		modality: "audio",
		civitaiAliases: ["higgs audio", "higgs-audio", "higgs v3"],
	},

	// Catch-all
	{
		id: "other",
		label: "Other",
		family: "other",
		modality: "image",
		civitaiAliases: [],
	},
] as const satisfies readonly BaseModelEntry[];

export type BaseModelId = (typeof BASE_MODELS)[number]["id"];

export const BASE_MODEL_IDS: readonly BaseModelId[] = BASE_MODELS.map(
	(model) => model.id
);

const baseModelById = new Map<BaseModelId, BaseModelEntry>(
	BASE_MODELS.map((model) => [model.id, model])
);

export function getBaseModel(id: BaseModelId): BaseModelEntry {
	const entry = baseModelById.get(id);
	if (!entry) {
		throw new Error(`Unknown base model id: ${id}`);
	}
	return entry;
}

export function getBaseModelLabel(id: string): string {
	const entry = baseModelById.get(id as BaseModelId);
	return entry?.label ?? id;
}

export function getBaseModelFamily(id: string): BaseModelFamily {
	const entry = baseModelById.get(id as BaseModelId);
	return entry?.family ?? "other";
}

export const BASE_MODEL_FAMILIES: readonly {
	id: BaseModelFamily;
	label: string;
}[] = [
	{ id: "flux", label: "Flux" },
	{ id: "qwen", label: "Qwen-Image" },
	{ id: "z-image", label: "Z-Image" },
	{ id: "image-other", label: "Other image" },
	{ id: "sdxl", label: "SDXL family" },
	{ id: "sd", label: "Stable Diffusion" },
	{ id: "video", label: "Video" },
	{ id: "audio", label: "Audio" },
	{ id: "other", label: "Other" },
];

export interface BaseModelGroup {
	family: BaseModelFamily;
	label: string;
	models: BaseModelEntry[];
}

/**
 * Group base models by family, preserving the canonical order from
 * `BASE_MODEL_FAMILIES`. Used for `<optgroup>` rendering.
 */
export function groupBaseModelsByFamily(
	ids: readonly string[] = BASE_MODEL_IDS
): BaseModelGroup[] {
	const groups = new Map<BaseModelFamily, BaseModelEntry[]>();
	for (const id of ids) {
		const entry = baseModelById.get(id as BaseModelId);
		if (!entry) {
			continue;
		}
		const list = groups.get(entry.family) ?? [];
		list.push(entry);
		groups.set(entry.family, list);
	}
	return BASE_MODEL_FAMILIES.flatMap((family) => {
		const models = groups.get(family.id);
		if (!models || models.length === 0) {
			return [];
		}
		return [{ family: family.id, label: family.label, models }];
	});
}

const civitaiNormalizePattern = /[\s_\-/]+/gu;

function normalizeCivitaiValue(value: string): string {
	return value.toLowerCase().replace(civitaiNormalizePattern, " ").trim();
}

interface CivitaiAliasEntry {
	id: BaseModelId;
	pattern: string;
}

const civitaiAliasIndex: CivitaiAliasEntry[] = BASE_MODELS.flatMap((model) =>
	model.civitaiAliases.map((alias) => ({
		id: model.id,
		pattern: normalizeCivitaiValue(alias),
	}))
)
	// Longer patterns first so "wan video 2.2" beats "wan video".
	.sort((left, right) => right.pattern.length - left.pattern.length);

/**
 * Map a raw Civitai `baseModel` string (e.g. "Flux.1 D", "SDXL Lightning",
 * "Wan Video 2.2 T2V-A14B") to a canonical `BaseModelId`. Returns `undefined`
 * when no alias matches — caller decides whether to fall back to "other".
 */
export function mapCivitaiBaseModel(
	value: string | null | undefined
): BaseModelId | undefined {
	if (!value) {
		return;
	}
	const normalized = normalizeCivitaiValue(value);
	if (!normalized) {
		return;
	}
	for (const entry of civitaiAliasIndex) {
		if (normalized.includes(entry.pattern)) {
			return entry.id;
		}
	}
	return;
}
