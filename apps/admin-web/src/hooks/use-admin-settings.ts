"use client";

import type { AdminSettingsSnapshot } from "@generator/contracts/admin";
import { useQuery } from "@tanstack/react-query";

import { fetchAdminSettings } from "@/lib/admin-settings-client";

export const adminSettingsQueryKey = ["admin", "settings"] as const;

export function useAdminSettings(
	initialSnapshot: AdminSettingsSnapshot | null
) {
	return useQuery({
		initialData: initialSnapshot ?? undefined,
		queryFn: fetchAdminSettings,
		queryKey: adminSettingsQueryKey,
		staleTime: 30_000,
	});
}
