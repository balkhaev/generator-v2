"use client";

import type { TrainingProviderName } from "@generator/contracts/admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminSettingsQueryKey } from "@/hooks/use-admin-settings";
import {
	fetchTrainingProvider,
	updateTrainingProvider,
} from "@/lib/training-provider-client";

export const trainingProviderQueryKey = ["admin", "training-provider"] as const;

export function useTrainingProvider() {
	return useQuery({
		queryFn: fetchTrainingProvider,
		queryKey: trainingProviderQueryKey,
		staleTime: 30_000,
	});
}

export function useUpdateTrainingProvider() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (provider: TrainingProviderName) =>
			updateTrainingProvider(provider),
		onSuccess: (snapshot) => {
			queryClient.setQueryData(trainingProviderQueryKey, snapshot);
			queryClient.invalidateQueries({ queryKey: adminSettingsQueryKey });
		},
	});
}
