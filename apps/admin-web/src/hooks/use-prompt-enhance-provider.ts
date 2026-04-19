"use client";

import type {
	PromptEnhanceProviderName,
	PromptEnhanceTarget,
} from "@generator/contracts/admin";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { adminSettingsQueryKey } from "@/hooks/use-admin-settings";
import { updatePromptEnhanceProvider } from "@/lib/prompt-enhance-provider-client";

export function useUpdatePromptEnhanceProvider() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			openRouterModel?: string;
			provider?: PromptEnhanceProviderName;
			target: PromptEnhanceTarget;
		}) => updatePromptEnhanceProvider(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: adminSettingsQueryKey });
		},
	});
}
