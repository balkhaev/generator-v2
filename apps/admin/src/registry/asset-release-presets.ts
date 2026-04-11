import type { AssetReleaseGroup } from "@/domain/asset-releases";
import flux2DevWorkflow from "../../../../workflows/f2d.json";
import lustifyApexAvatarWorkflow from "../../../../workflows/lustify-apex-avatar.json";
import redzitAvatarWorkflow from "../../../../workflows/redzit15-avatar.json";

type PresetAssetSource =
	| {
			content: string;
			contentType: string;
			kind: "inline";
	  }
	| {
			contentType: string;
			kind: "remote";
			url: string;
	  };

export interface AssetReleasePresetAsset {
	description: string;
	fileName: string;
	group: AssetReleaseGroup;
	label: string;
	source: PresetAssetSource;
}

export interface AssetReleasePresetSummary {
	assets: Pick<
		AssetReleasePresetAsset,
		"description" | "fileName" | "group" | "label"
	>[];
	description: string;
	id: string;
	name: string;
	sourceUrl: string;
	workflowKeys: readonly string[];
}

export interface AssetReleasePreset {
	assets: readonly AssetReleasePresetAsset[];
	description: string;
	id: string;
	name: string;
	sourceUrl: string;
	workflowKeys: readonly string[];
}

const redzitCheckpointDownloadUrl =
	"https://civitai.com/api/download/models/2462789?type=Model&format=SafeTensor&size=full&fp=bf16";
const lustifyApexCheckpointDownloadUrl =
	"https://civitai.com/api/download/models/2808677";

export const assetReleasePresetRegistry = {
	flux2dev: {
		assets: [
			{
				description:
					"Flux 2 Dev ComfyUI workflow template synchronized to worker volumes for reference-guided renders.",
				fileName: "f2d.json",
				group: "workflows",
				label: "Flux2 Dev workflow",
				source: {
					content: JSON.stringify(flux2DevWorkflow, null, 2),
					contentType: "application/json",
					kind: "inline",
				},
			},
		],
		description:
			"Workflow-only bundle for the Flux 2 Dev reference pipeline. Model weights must already exist on the shared ComfyUI volume.",
		id: "flux2dev",
		name: "Flux2 Dev workflow bundle",
		sourceUrl:
			"https://github.com/balkhaev/generator/blob/main/workflows/f2d.json",
		workflowKeys: ["flux2dev"],
	},
	"lustify-apex-avatar": {
		assets: [
			{
				description:
					"Primary Lustify SDXL APEX V8 checkpoint used for avatar generation.",
				fileName: "lustifySDXLNSFW_apexV8.safetensors",
				group: "checkpoints",
				label: "Lustify APEX V8 checkpoint",
				source: {
					contentType: "application/octet-stream",
					kind: "remote",
					url: lustifyApexCheckpointDownloadUrl,
				},
			},
			{
				description:
					"Minimal inline SDXL workflow shipped to volumes for reproducible avatar generation.",
				fileName: "lustify-apex-avatar.json",
				group: "workflows",
				label: "Lustify APEX avatar workflow",
				source: {
					content: JSON.stringify(lustifyApexAvatarWorkflow, null, 2),
					contentType: "application/json",
					kind: "inline",
				},
			},
		],
		description:
			"Checkpoint and workflow bundle for the Lustify SDXL APEX V8 portrait path sourced from Civitai model 573152 version 2808677.",
		id: "lustify-apex-avatar",
		name: "Lustify APEX avatar bundle",
		sourceUrl: "https://civitai.com/models/573152?modelVersionId=2808677",
		workflowKeys: ["lustify-apex-avatar"],
	},
	"redzit-1.5-avatar": {
		assets: [
			{
				description:
					"Full bf16 AIO checkpoint from the referenced Civitai model version.",
				fileName: "REDZ-v1.5-bf16-AIO.safetensors",
				group: "checkpoints",
				label: "RedZiT 1.5 avatar checkpoint",
				source: {
					contentType: "application/octet-stream",
					kind: "remote",
					url: redzitCheckpointDownloadUrl,
				},
			},
			{
				description:
					"Workflow template synchronized to every volume and loaded by the serverless worker for avatar generation.",
				fileName: "redzit15-avatar.json",
				group: "workflows",
				label: "RedZiT 1.5 avatar workflow",
				source: {
					content: JSON.stringify(redzitAvatarWorkflow, null, 2),
					contentType: "application/json",
					kind: "inline",
				},
			},
		],
		description:
			"Derived from the embedded ComfyUI workflows on the RedZiT 1.5 Civitai release and simplified into a standard text-to-image avatar pipeline for serverless execution.",
		id: "redzit-1.5-avatar",
		name: "RedZiT 1.5 avatar bundle",
		sourceUrl: "https://civitai.com/models/958009?modelVersionId=2462789",
		workflowKeys: ["redz-1.5-avatar"],
	},
} satisfies Record<string, AssetReleasePreset>;

export type AssetReleasePresetId = keyof typeof assetReleasePresetRegistry;

export function listAssetReleasePresets() {
	return Object.values(assetReleasePresetRegistry);
}

export function getAssetReleasePreset(presetId: string) {
	return assetReleasePresetRegistry[presetId as AssetReleasePresetId] ?? null;
}

export function toAssetReleasePresetSummary(
	preset: AssetReleasePreset
): AssetReleasePresetSummary {
	return {
		assets: preset.assets.map((asset) => ({
			description: asset.description,
			fileName: asset.fileName,
			group: asset.group,
			label: asset.label,
		})),
		description: preset.description,
		id: preset.id,
		name: preset.name,
		sourceUrl: preset.sourceUrl,
		workflowKeys: preset.workflowKeys,
	};
}
