export type LoraBaseModel = "z-image" | "flux" | "sdxl" | "other";

export const LORA_BASE_MODELS: LoraBaseModel[] = [
	"z-image",
	"flux",
	"sdxl",
	"other",
];

export type LoraStatus = "active" | "archived";

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
	sourceUrl: string | null;
	status: LoraStatus;
	updatedAt: string;
}

export interface CreateLoraFromUrlInput {
	baseModel: LoraBaseModel;
	defaultWeight?: number;
	description?: string;
	name: string;
	sourceUrl: string;
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
