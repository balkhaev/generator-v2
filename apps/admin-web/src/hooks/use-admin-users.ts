"use client";

import type {
	CreateAdminUserInput,
	ListAdminUsersQuery,
	ResetAdminUserPasswordInput,
	UpdateAdminUserInput,
} from "@generator/contracts/admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	createAdminUser,
	deleteAdminUser,
	fetchAdminUsers,
	resetAdminUserPassword,
	updateAdminUser,
} from "@/lib/users-client";

export const adminUsersQueryKey = (query: ListAdminUsersQuery = {}) =>
	["admin", "users", query] as const;

export function useAdminUsers(query: ListAdminUsersQuery = {}) {
	return useQuery({
		queryFn: () => fetchAdminUsers(query),
		queryKey: adminUsersQueryKey(query),
	});
}

export function useCreateAdminUser() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateAdminUserInput) => createAdminUser(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
		},
	});
}

export function useUpdateAdminUser() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, patch }: { id: string; patch: UpdateAdminUserInput }) =>
			updateAdminUser(id, patch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
		},
	});
}

export function useResetAdminUserPassword() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			input,
		}: {
			id: string;
			input: ResetAdminUserPasswordInput;
		}) => resetAdminUserPassword(id, input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
		},
	});
}

export function useDeleteAdminUser() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteAdminUser(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
		},
	});
}
