"use client";

import type {
	CreateLoraFromUrlInput,
	ListLorasQuery,
	PreviewLoraSourceInput,
	UpdateLoraInput,
} from "@generator/contracts/loras";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	archiveLora,
	createLoraFromUrl,
	fetchAdminLoras,
	previewLoraSource,
	updateLora,
} from "@/lib/loras-client";

export const adminLorasQueryKey = (query: ListLorasQuery = {}) =>
	["admin", "loras", query] as const;

export function useAdminLoras(query: ListLorasQuery = {}) {
	return useQuery({
		queryKey: adminLorasQueryKey(query),
		queryFn: () => fetchAdminLoras(query),
	});
}

export function useCreateLora() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateLoraFromUrlInput) => createLoraFromUrl(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "loras"] });
		},
	});
}

export function usePreviewLoraSource() {
	return useMutation({
		mutationFn: (input: PreviewLoraSourceInput) => previewLoraSource(input),
	});
}

export function useUpdateLora() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, patch }: { id: string; patch: UpdateLoraInput }) =>
			updateLora(id, patch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "loras"] });
		},
	});
}

export function useArchiveLora() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => archiveLora(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "loras"] });
		},
	});
}
