"use client";

import type {
	AdminWorkflowDetailResponse,
	AdminWorkflowListResponse,
	UpdateAdminWorkflowInput,
} from "@generator/contracts/admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	fetchAdminWorkflows,
	updateAdminWorkflow,
} from "@/lib/admin-workflows-client";

export const adminWorkflowsQueryKey = ["admin", "workflows"] as const;

export function useAdminWorkflows(
	initialData: AdminWorkflowListResponse | null
) {
	return useQuery({
		initialData: initialData ?? undefined,
		queryFn: fetchAdminWorkflows,
		queryKey: adminWorkflowsQueryKey,
		staleTime: 30_000,
	});
}

export function useUpdateAdminWorkflow() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			input,
			workflowKey,
		}: {
			input: UpdateAdminWorkflowInput;
			workflowKey: string;
		}) => updateAdminWorkflow(workflowKey, input),
		onSuccess: (response: AdminWorkflowDetailResponse) => {
			queryClient.setQueryData<AdminWorkflowListResponse>(
				adminWorkflowsQueryKey,
				(current) => {
					if (!current) {
						return {
							inactiveWorkflowKeys: response.inactiveWorkflowKeys,
							workflows: [response.workflow],
						};
					}
					return {
						inactiveWorkflowKeys: response.inactiveWorkflowKeys,
						workflows: current.workflows.map((workflow) =>
							workflow.key === response.workflow.key
								? response.workflow
								: workflow
						),
					};
				}
			);
		},
	});
}
