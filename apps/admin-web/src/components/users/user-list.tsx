"use client";

import type { AdminUser } from "@generator/contracts/admin";
import { Button } from "@generator/ui/components/button";
import { EmptyState } from "@generator/ui/components/empty-state";
import { SearchInput } from "@generator/ui/components/search-input";
import { Loader2, UserPlus } from "lucide-react";

import UserRow from "./user-row";

export default function UserList({
	currentUserId,
	isLoading,
	onCreate,
	onSearchChange,
	onSelect,
	search,
	selectedId,
	users,
}: {
	currentUserId: string | null;
	isLoading: boolean;
	onCreate?: () => void;
	onSearchChange: (value: string) => void;
	onSelect: (id: string) => void;
	search: string;
	selectedId: string | null;
	users: AdminUser[];
}) {
	return (
		<div className="grid gap-3">
			<div className="flex items-center justify-between gap-3">
				<p className="text-muted-foreground text-xs">
					Manage admin console operators. Each user can sign in with email and
					password.
				</p>
				<SearchInput
					aria-label="Search users"
					className="w-56"
					onValueChange={onSearchChange}
					placeholder="Search by name or email"
					value={search}
				/>
			</div>

			{renderBody({
				currentUserId,
				isLoading,
				onCreate,
				onSelect,
				selectedId,
				users,
			})}
		</div>
	);
}

function renderBody({
	currentUserId,
	isLoading,
	onCreate,
	onSelect,
	selectedId,
	users,
}: {
	currentUserId: string | null;
	isLoading: boolean;
	onCreate?: () => void;
	onSelect: (id: string) => void;
	selectedId: string | null;
	users: AdminUser[];
}) {
	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
				<Loader2 className="mr-2 size-4 animate-spin" />
				Loading…
			</div>
		);
	}
	if (users.length === 0) {
		return (
			<EmptyState
				action={
					onCreate ? (
						<Button onClick={onCreate} size="sm" type="button">
							<UserPlus data-icon="inline-start" />
							Create user
						</Button>
					) : null
				}
				hint="Create the first operator to get started."
				message="No users yet"
			/>
		);
	}
	return (
		<div className="grid gap-1.5">
			{users.map((user) => (
				<UserRow
					isCurrentUser={user.id === currentUserId}
					isSelected={user.id === selectedId}
					key={user.id}
					onSelect={onSelect}
					user={user}
				/>
			))}
		</div>
	);
}
