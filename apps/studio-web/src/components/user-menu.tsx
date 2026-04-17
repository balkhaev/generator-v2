"use client";

import { authClient } from "@generator/auth-client";
import { Button } from "@generator/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@generator/ui/components/dropdown-menu";
import { LogOut, Mail, Settings2 } from "lucide-react";

function buildAvatarInitial(name: string) {
	const trimmed = name.trim();

	if (!trimmed) {
		return "?";
	}

	return trimmed[0].toUpperCase();
}

export default function UserMenu({
	email,
	name,
}: {
	email?: string | null;
	name: string;
}) {
	function handleSignOut() {
		authClient.signOut({
			fetchOptions: {
				onSuccess: () => {
					window.location.href = "/login";
				},
			},
		});
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button aria-label={`Account: ${name}`} size="sm" variant="outline" />
				}
			>
				<span
					aria-hidden="true"
					className="flex size-4 items-center justify-center rounded-full bg-foreground text-[10px] text-background"
				>
					{buildAvatarInitial(name)}
				</span>
				<span className="hidden max-w-[160px] truncate sm:inline">{name}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[220px] bg-card">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Signed in as</DropdownMenuLabel>
					<DropdownMenuItem disabled>
						<Mail className="size-3.5" />
						<span className="truncate">{email ?? name}</span>
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem disabled>
						<Settings2 className="size-3.5" />
						Preferences
						<DropdownMenuShortcut>soon</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={handleSignOut} variant="destructive">
						<LogOut className="size-3.5" />
						Sign out
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
