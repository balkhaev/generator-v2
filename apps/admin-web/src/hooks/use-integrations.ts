"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	deleteIntegrationCredential,
	listIntegrationCredentials,
	setIntegrationCredential,
} from "@/lib/integrations-client";

export const integrationsQueryKey = ["integrations", "credentials"] as const;

export function useIntegrationCredentials() {
	return useQuery({
		queryFn: () => listIntegrationCredentials(),
		queryKey: integrationsQueryKey,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});
}

export function useSetIntegrationCredential() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: setIntegrationCredential,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: integrationsQueryKey });
		},
	});
}

export function useDeleteIntegrationCredential() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: deleteIntegrationCredential,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: integrationsQueryKey });
		},
	});
}
