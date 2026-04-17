export type LoraBaseModel = "z-image" | "flux" | "sdxl" | "other";

export const LORA_BASE_MODELS: LoraBaseModel[] = [
	"z-image",
	"flux",
	"sdxl",
	"other",
];

export type LoraStatus = "active" | "archived";

export type LoraSourceProvider = "auto" | "civitai" | "direct" | "huggingface";

export interface LoraRegistryEntry {
	baseModel: LoraBaseModel;
	createdAt: string;
	defaultWeight: number;
	description: string;
	id: string;
	name: string;
	s3Key: string;
	s3Url: string;
	sizeBytes: number;
	slug: string;
	sourceProvider?: Exclude<LoraSourceProvider, "auto">;
	sourceUrl: string | null;
	status: LoraStatus;
	updatedAt: string;
}

export interface CreateLoraFromUrlInput {
	baseModel: LoraBaseModel;
	defaultWeight?: number;
	description?: string;
	name?: string;
	sourceFilePath?: string;
	sourceProvider?: LoraSourceProvider;
	sourceRevision?: string;
	sourceUrl: string;
	sourceVersionId?: number;
}

export interface PreviewLoraSourceInput {
	sourceFilePath?: string;
	sourceProvider?: LoraSourceProvider;
	sourceRevision?: string;
	sourceUrl: string;
	sourceVersionId?: number;
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
	versionId: number;
	versionName: string;
}

export interface LoraSourcePreview {
	baseModel?: LoraBaseModel;
	description?: string;
	downloadUrl: string;
	fileName?: string;
	name?: string;
	previewImageUrl?: string;
	previewMediaType?: LoraPreviewMediaType;
	previewMediaUrl?: string;
	provider: Exclude<LoraSourceProvider, "auto">;
	sizeBytes?: number;
	sourceUrl: string;
	sourceVersionId?: number;
	trainedWords?: string[];
	variants?: LoraSourcePreviewVariant[];
	versionName?: string;
}

export interface UpdateLoraInput {
	baseModel?: LoraBaseModel;
	defaultWeight?: number;
	description?: string;
	name?: string;
	status?: LoraStatus;
}

export interface ListLorasQuery {
	baseModel?: LoraBaseModel;
	status?: LoraStatus;
}
