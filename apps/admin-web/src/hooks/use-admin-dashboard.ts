"use client";

import type { AdminDashboardSnapshot } from "@generator/contracts/admin";
import { useQuery } from "@tanstack/react-query";

import { fetchAdminDashboard } from "@/lib/api/dashboard";

export const adminDashboardQueryKey = ["admin", "dashboard"] as const;

export function useAdminDashboard(initialData?: AdminDashboardSnapshot) {
	return useQuery({
		queryKey: adminDashboardQueryKey,
		queryFn: fetchAdminDashboard,
		initialData,
		refetchInterval: 15_000,
	});
}
