import type { BaseModelId } from "./base-models";
import { BASE_MODEL_IDS } from "./base-models";

export type LoraBaseModel = BaseModelId;

export const LORA_BASE_MODELS: readonly LoraBaseModel[] = BASE_MODEL_IDS;

export type LoraStatus = "active" | "archived";

export type LoraSourceProvider = "auto" | "civitai" | "direct" | "huggingface";

/**
 * Wan 2.2 A14B uses two transformers (high-noise + low-noise) and LoRAs are
 * usually trained for each separately. `high` / `low` mark such files; `both`
 * marks LoRAs that should be loaded into both experts (rare). For models like
 * Flux that only have one transformer, `variant` stays `null`.
 */
export type LoraVariant = "high" | "low" | "both";

export const LORA_VARIANTS: readonly LoraVariant[] = ["high", "low", "both"];

export interface LoraRegistryEntry {
	baseModel: LoraBaseModel;
	createdAt: string;
	defaultWeight: number;
	description: string;
	id: string;
	name: string;
	pairGroupId: string | null;
	s3Key: string;
	s3Url: string;
	sizeBytes: number;
	slug: string;
	sourceProvider?: Exclude<LoraSourceProvider, "auto">;
	sourceUrl: string | null;
	status: LoraStatus;
	/**
	 * Trigger words (a.k.a. trainedWords on Civitai) that activate the LoRA.
	 * Studio/persons prepend these to the user prompt at run time so the model
	 * actually engages the LoRA's learned subject/style.
	 */
	triggerWords: string[];
	updatedAt: string;
	variant: LoraVariant | null;
}

export interface CreateLoraFromUrlInput {
	baseModel: LoraBaseModel;
	defaultWeight?: number;
	description?: string;
	name?: string;
	/**
	 * Optional: import the matching variant for a Wan 2.2 LoRA in the same
	 * request. When provided, two registry entries are created and linked via
	 * a shared `pairGroupId`.
	 */
	pair?: {
		defaultWeight?: number;
		description?: string;
		name?: string;
		sourceFilePath?: string;
		sourceUrl: string;
		sourceVersionId?: number;
		triggerWords?: string[];
		variant: Exclude<LoraVariant, "both">;
	};
	sourceFilePath?: string;
	sourceProvider?: LoraSourceProvider;
	sourceRevision?: string;
	sourceUrl: string;
	sourceVersionId?: number;
	/**
	 * Override the trigger words detected from the source. When omitted, the
	 * Civitai resolver's `trainedWords` are persisted automatically.
	 */
	triggerWords?: string[];
	variant?: LoraVariant;
}

export interface PreviewLoraSourceInput {
	checkCivitaiLtx23Inference?: boolean;
	sourceFilePath?: string;
	sourceProvider?: LoraSourceProvider;
	sourceRevision?: string;
	sourceUrl: string;
	sourceVersionId?: number;
}

export interface LoraInferenceAvailability {
	reason?: string;
	status: "available" | "unavailable" | "unchecked";
	target: "civitai-ltx-2-3";
}

export type LoraPreviewMediaType = "image" | "video";

export interface LoraSourcePreviewVariant {
	baseModel?: LoraBaseModel;
	description?: string;
	downloadUrl: string;
	fileName?: string;
	mediaType?: LoraPreviewMediaType;
	mediaUrl?: string;
	sizeBytes?: number;
	trainedWords?: string[];
	/** Detected high/low expert assignment for Wan 2.2 LoRAs. */
	variant?: LoraVariant;
	versionId: number;
	versionName: string;
}

export interface LoraSourcePreview {
	baseModel?: LoraBaseModel;
	description?: string;
	downloadUrl: string;
	fileName?: string;
	inference?: {
		civitaiLtx23?: LoraInferenceAvailability;
	};
	modelId?: number;
	name?: string;
	nsfw?: boolean;
	/**
	 * For dual-expert models (Wan 2.2): when the source contains both high and
	 * low files, this lists the matched pair so the import flow can create the
	 * two registry entries in one call.
	 */
	pairedFiles?: LoraSourcePreviewPairedFile[];
	previewImageUrl?: string;
	previewMediaType?: LoraPreviewMediaType;
	previewMediaUrl?: string;
	provider: Exclude<LoraSourceProvider, "auto">;
	sizeBytes?: number;
	sourceUrl: string;
	sourceVersionId?: number;
	supportsGeneration?: boolean;
	trainedWords?: string[];
	variant?: LoraVariant;
	variants?: LoraSourcePreviewVariant[];
	versionName?: string;
}

export interface LoraSourcePreviewPairedFile {
	downloadUrl: string;
	fileName?: string;
	sizeBytes?: number;
	sourceUrl: string;
	sourceVersionId?: number;
	variant: Exclude<LoraVariant, "both">;
}

export interface UpdateLoraInput {
	baseModel?: LoraBaseModel;
	defaultWeight?: number;
	description?: string;
	name?: string;
	pairGroupId?: string | null;
	status?: LoraStatus;
	triggerWords?: string[];
	variant?: LoraVariant | null;
}

export interface ListLorasQuery {
	baseModel?: LoraBaseModel;
	status?: LoraStatus;
}

/** Base models whose LoRAs come as separate high/low files. */
export const DUAL_EXPERT_BASE_MODELS: readonly LoraBaseModel[] = ["wan-2-2"];

export function isDualExpertBaseModel(baseModel: LoraBaseModel): boolean {
	return DUAL_EXPERT_BASE_MODELS.includes(baseModel);
}
