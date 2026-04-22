"use client";

import type {
	StorageListObjectsQuery,
	StorageOverviewSnapshot,
	StoragePresignUploadInput,
} from "@generator/contracts/admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	checkStorageHealth,
	createStoragePresignedUpload,
	deleteStorageObject,
	deleteStorageOrphans,
	fetchStorageObjects,
	fetchStorageOverview,
	scanStorageOrphans,
	uploadStorageObject,
} from "@/lib/storage-client";

export const storageOverviewQueryKey = [
	"admin",
	"storage",
	"overview",
] as const;

export const storageObjectsQueryKey = (query: StorageListObjectsQuery) =>
	["admin", "storage", "objects", query] as const;

export function useStorageOverview(
	initialOverview: StorageOverviewSnapshot | null
) {
	return useQuery({
		initialData: initialOverview ?? undefined,
		queryFn: fetchStorageOverview,
		queryKey: storageOverviewQueryKey,
		staleTime: 30_000,
	});
}

export function useStorageObjects(
	query: StorageListObjectsQuery,
	enabled: boolean
) {
	return useQuery({
		enabled,
		queryFn: () => fetchStorageObjects(query),
		queryKey: storageObjectsQueryKey(query),
		staleTime: 10_000,
	});
}

export function useStorageHealthCheck() {
	return useMutation({
		mutationFn: checkStorageHealth,
	});
}

export function useScanStorageOrphans() {
	return useMutation({
		mutationFn: scanStorageOrphans,
	});
}

export function useDeleteStorageOrphans() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: deleteStorageOrphans,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "storage"] });
		},
	});
}

export function useUploadStorageObject() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: uploadStorageObject,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "storage"] });
		},
	});
}

export function useCreateStoragePresignedUpload() {
	return useMutation({
		mutationFn: (input: StoragePresignUploadInput) =>
			createStoragePresignedUpload(input),
	});
}

export function useDeleteStorageObject() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: deleteStorageObject,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "storage"] });
		},
	});
}
