"use client";

import { ModeToggle } from "./mode-toggle";
import { TrainingProviderSwitcher } from "./training/training-provider-switcher";
import UserMenu from "./user-menu";

export default function WorkspaceActions() {
	return (
		<div className="flex items-center gap-2">
			<TrainingProviderSwitcher />
			<ModeToggle />
			<UserMenu />
		</div>
	);
}
