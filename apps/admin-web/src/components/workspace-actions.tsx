"use client";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function WorkspaceActions() {
	return (
		<div className="flex items-center gap-2">
			<ModeToggle />
			<UserMenu />
		</div>
	);
}
