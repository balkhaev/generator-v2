"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	type AssetReleaseSnapshot,
	fetchAssetRelease,
	fetchAssetReleasePresets,
	fetchAssetReleases,
	provisionAssetReleasePreset,
} from "@/lib/asset-releases-client";

const TERMINAL_STATUSES = new Set(["ready", "degraded", "failed"]);

export const assetReleasesQueryKey = (limit: number) =>
	["admin", "asset-releases", { limit }] as const;
export const assetReleaseQueryKey = (id: string) =>
	["admin", "asset-release", id] as const;
export const assetReleasePresetsQueryKey = [
	"admin",
	"asset-release-presets",
] as const;

export function useAssetReleases(limit = 5) {
	return useQuery({
		queryKey: assetReleasesQueryKey(limit),
		queryFn: () => fetchAssetReleases(limit),
		refetchInterval: 5000,
	});
}

export function useAssetRelease(id: string | null) {
	return useQuery({
		queryKey: id ? assetReleaseQueryKey(id) : ["admin", "asset-release", "_"],
		queryFn: () => {
			if (!id) {
				throw new Error("missing id");
			}
			return fetchAssetRelease(id);
		},
		enabled: Boolean(id),
		refetchInterval: (query) => {
			const data = query.state.data as AssetReleaseSnapshot | undefined;
			if (!data) {
				return 2000;
			}
			return TERMINAL_STATUSES.has(data.status) ? false : 2000;
		},
	});
}

export function useAssetReleasePresets() {
	return useQuery({
		queryKey: assetReleasePresetsQueryKey,
		queryFn: () => fetchAssetReleasePresets().catch(() => []),
	});
}

export function useProvisionPreset() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (presetId: string) => provisionAssetReleasePreset(presetId),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["admin", "asset-releases"],
			});
		},
	});
}
