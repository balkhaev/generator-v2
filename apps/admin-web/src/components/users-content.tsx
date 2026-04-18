"use client";

import { authClient } from "@generator/auth-client";
import { Button } from "@generator/ui/components/button";
import { PageHeader } from "@generator/ui/components/page-header";
import { cn } from "@generator/ui/lib/utils";
import { RefreshCw, UserPlus } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import UserDetail from "@/components/users/user-detail";
import UserForm from "@/components/users/user-form";
import UserList from "@/components/users/user-list";
import { useAdminUsers } from "@/hooks/use-admin-users";

function useCurrentUserId() {
	const { data } = authClient.useSession();
	return data?.user?.id ?? null;
}

export default function UsersContent() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [search, setSearch] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const selectedId = searchParams?.get("id") ?? null;
	const currentUserId = useCurrentUserId();

	const query = useMemo(
		() => (search.trim() ? { search: search.trim() } : {}),
		[search]
	);

	const {
		data: users = [],
		isFetching,
		isLoading,
		refetch,
	} = useAdminUsers(query);

	const handleSelect = useCallback(
		(id: string) => {
			const params = new URLSearchParams(searchParams?.toString() ?? "");
			if (selectedId === id) {
				params.delete("id");
			} else {
				params.set("id", id);
			}
			const searchString = params.toString();
			router.replace(
				`${pathname}${searchString ? `?${searchString}` : ""}` as Route
			);
		},
		[pathname, router, searchParams, selectedId]
	);

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
			<PageHeader
				actions={
					<>
						<Button onClick={() => setCreateOpen(true)} size="sm" type="button">
							<UserPlus data-icon="inline-start" />
							Create user
						</Button>
						<button
							className="inline-flex items-center gap-2 rounded-md border border-foreground/10 bg-background px-2.5 py-1.5 text-xs transition hover:bg-muted/30 disabled:opacity-50"
							disabled={isFetching}
							onClick={() => refetch()}
							type="button"
						>
							<RefreshCw
								className={cn("size-3", isFetching ? "animate-spin" : "")}
							/>
							Refresh
						</button>
					</>
				}
				description="Operators with access to the admin console."
				eyebrow="User management"
				title="Users"
			/>

			<div className="min-h-0 overflow-y-auto px-4 py-4">
				<UserList
					currentUserId={currentUserId}
					isLoading={isLoading}
					onCreate={() => setCreateOpen(true)}
					onSearchChange={setSearch}
					onSelect={handleSelect}
					search={search}
					selectedId={selectedId}
					users={users}
				/>
			</div>

			<UserForm onOpenChange={setCreateOpen} open={createOpen} />
		</div>
	);
}

export function UsersInspector() {
	const searchParams = useSearchParams();
	const selectedId = searchParams?.get("id") ?? null;
	const currentUserId = useCurrentUserId();
	const { data: users = [] } = useAdminUsers();
	const selected = users.find((user) => user.id === selectedId) ?? null;
	return (
		<div className="h-full overflow-hidden rounded-lg border border-foreground/6 bg-background/80 backdrop-blur-xl dark:border-foreground/10 dark:bg-background/60">
			<UserDetail currentUserId={currentUserId} user={selected} />
		</div>
	);
}
