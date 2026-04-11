import type {
	AssetReleaseService,
	AssetReleaseSnapshot,
} from "@/domain/asset-releases";
import {
	getAssetReleasePreset,
	listAssetReleasePresets,
	toAssetReleasePresetSummary,
} from "@/registry/asset-release-presets";

type FetchLike = typeof fetch;

export class AssetReleasePresetService {
	constructor(
		private readonly assetReleaseService: AssetReleaseService,
		private readonly fetchImpl: FetchLike = fetch
	) {}

	listPresets() {
		return listAssetReleasePresets().map(toAssetReleasePresetSummary);
	}

	async provisionPreset(presetId: string) {
		const preset = getAssetReleasePreset(presetId);
		if (!preset) {
			throw new Error(`Unknown asset release preset: ${presetId}`);
		}

		const releases: AssetReleaseSnapshot[] = [];
		for (const asset of preset.assets) {
			const file = await this.resolveAssetFile(asset);
			const release = await this.assetReleaseService.createRelease({
				files: [file],
				group: asset.group,
				label: asset.label,
			});

			releases.push(release);
		}

		return {
			preset: toAssetReleasePresetSummary(preset),
			releases,
		};
	}

	private async resolveAssetFile(
		asset: ReturnType<typeof listAssetReleasePresets>[number]["assets"][number]
	) {
		if (asset.source.kind === "inline") {
			return new File([asset.source.content], asset.fileName, {
				type: asset.source.contentType,
			});
		}

		const headers = new Headers({
			accept: "*/*",
			"user-agent": "admin-asset-preset/1.0",
		});
		if (
			asset.source.url.startsWith("https://civitai.com/") &&
			process.env.CIVITAI_API_KEY
		) {
			headers.set("authorization", `Bearer ${process.env.CIVITAI_API_KEY}`);
		}

		const response = await this.fetchImpl(asset.source.url, { headers });
		if (!response.ok) {
			throw new Error(
				`Unable to download preset asset ${asset.fileName}: ${response.status}`
			);
		}

		return new File([await response.arrayBuffer()], asset.fileName, {
			type:
				response.headers.get("content-type") ??
				asset.source.contentType ??
				"application/octet-stream",
		});
	}
}
