"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchOpenRouterModels } from "@/lib/openrouter-models-client";

export const openRouterModelsQueryKey = ["admin", "openrouter-models"] as const;

export function useOpenRouterModels(options?: { enabled?: boolean }) {
	return useQuery({
		enabled: options?.enabled ?? false,
		queryFn: fetchOpenRouterModels,
		queryKey: openRouterModelsQueryKey,
		staleTime: 3_600_000,
	});
}
