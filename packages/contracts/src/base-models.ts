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
	| "sdxl"
	| "sd"
	| "z-image"
	| "image-other"
	| "video"
	| "other";

export type BaseModelModality = "image" | "video";

export interface BaseModelEntry {
	/** Civitai `baseModel` strings (case-insensitive substring match after normalization). */
	civitaiAliases: readonly string[];
	family: BaseModelFamily;
	id: string;
	label: string;
	modality: BaseModelModality;
}

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
		label: "Flux Kontext",
		family: "flux",
		modality: "image",
		civitaiAliases: ["flux.1 kontext", "flux kontext", "kontext"],
	},
	{
		id: "flux-2",
		label: "Flux 2",
		family: "flux",
		modality: "image",
		civitaiAliases: ["flux.2", "flux 2", "flux2"],
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
	{
		id: "pony",
		label: "Pony",
		family: "sdxl",
		modality: "image",
		civitaiAliases: ["pony"],
	},
	{
		id: "illustrious",
		label: "Illustrious",
		family: "sdxl",
		modality: "image",
		civitaiAliases: ["illustrious"],
	},
	{
		id: "noob-ai",
		label: "NoobAI",
		family: "sdxl",
		modality: "image",
		civitaiAliases: ["noobai", "noob ai"],
	},

	// SD family (legacy)
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
	{
		id: "sd-2",
		label: "SD 2.x",
		family: "sd",
		modality: "image",
		civitaiAliases: [
			"sd 2.0",
			"sd 2.1",
			"sd 2.0 768",
			"sd 2.1 768",
			"sd 2.1 unclip",
		],
	},
	{
		id: "sd-3",
		label: "SD 3",
		family: "sd",
		modality: "image",
		civitaiAliases: ["sd 3"],
	},
	{
		id: "sd-3-5",
		label: "SD 3.5",
		family: "sd",
		modality: "image",
		civitaiAliases: [
			"sd 3.5",
			"sd 3.5 medium",
			"sd 3.5 large",
			"sd 3.5 large turbo",
		],
	},

	// Z-Image
	{
		id: "z-image",
		label: "Z-Image",
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
		civitaiAliases: ["hidream", "hi-dream", "hi dream"],
	},
	{
		id: "lumina",
		label: "Lumina",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["lumina"],
	},
	{
		id: "kolors",
		label: "Kolors",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["kolors"],
	},
	{
		id: "aura-flow",
		label: "Aura Flow",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["aura flow", "auraflow"],
	},
	{
		id: "stable-cascade",
		label: "Stable Cascade",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["stable cascade", "cascade"],
	},
	{
		id: "pixart",
		label: "PixArt",
		family: "image-other",
		modality: "image",
		civitaiAliases: ["pixart a", "pixart e", "pixart-a", "pixart-e", "pixart"],
	},

	// Video
	{
		id: "wan",
		label: "Wan",
		family: "video",
		modality: "video",
		civitaiAliases: [
			"wan video 1.3b",
			"wan video 14b",
			"wan video 2.1",
			"wan video t2v",
			"wan video i2v",
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
			"wan video 2.2 ti2v-5b",
			"wan video 2.2 t2v-a14b",
			"wan video 2.2 i2v-a14b",
		],
	},
	{
		id: "ltx",
		label: "LTX Video",
		family: "video",
		modality: "video",
		civitaiAliases: [
			"ltxv",
			"ltx video",
			"ltx-video",
			"ltx 2",
			"ltx 2.3",
			"ltxv 13b",
		],
	},
	{
		id: "hunyuan-video",
		label: "Hunyuan Video",
		family: "video",
		modality: "video",
		civitaiAliases: ["hunyuan video", "hunyuanvideo"],
	},
	{
		id: "cogvideox",
		label: "CogVideoX",
		family: "video",
		modality: "video",
		civitaiAliases: ["cogvideox", "cog video x", "cogvideo"],
	},
	{
		id: "mochi",
		label: "Mochi",
		family: "video",
		modality: "video",
		civitaiAliases: ["mochi"],
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
	{ id: "sdxl", label: "SDXL family" },
	{ id: "sd", label: "Stable Diffusion" },
	{ id: "z-image", label: "Z-Image" },
	{ id: "image-other", label: "Other image" },
	{ id: "video", label: "Video" },
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
