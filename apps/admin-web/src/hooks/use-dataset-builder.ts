"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { adminSettingsQueryKey } from "@/hooks/use-admin-settings";
import { updateDatasetBuilderModel } from "@/lib/dataset-builder-client";

export function useUpdateDatasetBuilderModel() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { model: string }) => updateDatasetBuilderModel(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: adminSettingsQueryKey });
		},
	});
}
