import type {
	AssetReleaseGroup,
	AssetReleasePreset,
	AssetReleaseSnapshot,
} from "@generator/contracts/admin";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

export type {
	AssetReleaseGroup,
	AssetReleasePreset,
	AssetReleaseSnapshot,
	VolumeDistributionJobSnapshot,
} from "@generator/contracts/admin";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

export async function fetchAssetRelease(releaseId: string) {
	const payload = await requestJson<{ release: AssetReleaseSnapshot }>(
		`${API_BASE_URL}/api/asset-releases/${releaseId}`,
		{
			credentials: "include",
		}
	);

	return payload.release;
}

export async function fetchAssetReleases(limit = 5) {
	const payload = await requestJson<{ releases: AssetReleaseSnapshot[] }>(
		`${API_BASE_URL}/api/asset-releases?limit=${limit}`,
		{
			credentials: "include",
		}
	);

	return payload.releases;
}

export async function fetchAssetReleasePresets() {
	const payload = await requestJson<{ presets: AssetReleasePreset[] }>(
		`${API_BASE_URL}/api/asset-release-presets`,
		{
			credentials: "include",
		}
	);

	return payload.presets;
}

export function provisionAssetReleasePreset(presetId: string) {
	return requestJson<{
		preset: AssetReleasePreset;
		releases: AssetReleaseSnapshot[];
	}>(`${API_BASE_URL}/api/asset-release-presets/${presetId}/provision`, {
		method: "POST",
		credentials: "include",
	});
}

export function uploadAssetRelease(input: {
	files: File[];
	group: AssetReleaseGroup;
	label: string;
	onProgress?: (progressPct: number) => void;
}) {
	return new Promise<AssetReleaseSnapshot>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		const formData = new FormData();

		formData.append("group", input.group);
		formData.append("label", input.label);
		for (const file of input.files) {
			formData.append("files", file);
		}

		xhr.open("POST", `${API_BASE_URL}/api/asset-releases`);
		xhr.withCredentials = true;
		xhr.responseType = "json";
		xhr.upload.onprogress = (event) => {
			if (!(event.lengthComputable && input.onProgress)) {
				return;
			}

			input.onProgress(Math.round((event.loaded / event.total) * 100));
		};
		xhr.onerror = () => {
			reject(new Error("Asset upload failed."));
		};
		xhr.onload = () => {
			if (xhr.status < 200 || xhr.status >= 300) {
				const errorMessage =
					typeof xhr.response === "object" &&
					xhr.response &&
					"error" in xhr.response
						? String(xhr.response.error)
						: xhr.responseText || `${xhr.status} ${xhr.statusText}`.trim();
				reject(new Error(errorMessage));
				return;
			}

			const payload = xhr.response as { release: AssetReleaseSnapshot };
			resolve(payload.release);
		};
		xhr.send(formData);
	});
}
