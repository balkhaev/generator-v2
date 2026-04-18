"use client";

import type { AdminUser } from "@generator/contracts/admin";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { cn } from "@generator/ui/lib/utils";
import { ChevronRight, KeyRound, MailCheck, MailX } from "lucide-react";

export default function UserRow({
	isCurrentUser,
	isSelected,
	onSelect,
	user,
}: {
	isCurrentUser: boolean;
	isSelected: boolean;
	onSelect: (id: string) => void;
	user: AdminUser;
}) {
	return (
		<button
			aria-current={isSelected}
			className={cn(
				"grid w-full items-center gap-2 rounded-md border border-transparent px-3 py-2.5 text-left transition",
				isSelected
					? "border-foreground/15 bg-muted/35"
					: "bg-muted/15 hover:bg-muted/25 dark:bg-muted/8"
			)}
			onClick={() => onSelect(user.id)}
			type="button"
		>
			<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
				<div className="grid min-w-0 gap-1">
					<div className="flex items-center gap-2">
						<p className="truncate font-medium text-sm">{user.name}</p>
						{isCurrentUser ? <StatusBadge tone="info">you</StatusBadge> : null}
						{user.emailVerified ? (
							<StatusBadge tone="success">
								<MailCheck className="size-3" />
								verified
							</StatusBadge>
						) : (
							<StatusBadge tone="warning">
								<MailX className="size-3" />
								unverified
							</StatusBadge>
						)}
						{user.hasPassword ? null : (
							<StatusBadge tone="warning">
								<KeyRound className="size-3" />
								no password
							</StatusBadge>
						)}
					</div>
					<p className="truncate text-[11px] text-muted-foreground">
						<span className="font-mono">{user.email}</span>
						{" · "}
						{user.sessionsCount} session
						{user.sessionsCount === 1 ? "" : "s"}
						{" · "}
						{user.accountsCount} account
						{user.accountsCount === 1 ? "" : "s"}
					</p>
				</div>
				<ChevronRight className="size-3.5 text-muted-foreground" />
			</div>
		</button>
	);
}
