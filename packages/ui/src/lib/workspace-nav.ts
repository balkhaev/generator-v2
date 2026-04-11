import {
	Clapperboard,
	type LucideIcon,
	ShieldEllipsis,
	UsersRound,
} from "lucide-react";

export type WorkspaceId = "admin" | "persons" | "studio";

interface WorkspaceDefinition {
	icon: LucideIcon;
	label: string;
	shortLabel: string;
}

const workspaceDefinitions: Record<WorkspaceId, WorkspaceDefinition> = {
	admin: {
		icon: ShieldEllipsis,
		label: "Admin",
		shortLabel: "Adm",
	},
	persons: {
		icon: UsersRound,
		label: "Persons",
		shortLabel: "Cast",
	},
	studio: {
		icon: Clapperboard,
		label: "Studio",
		shortLabel: "Std",
	},
};

export function createWorkspaceNavigation(
	current: WorkspaceId,
	urls: Record<WorkspaceId, string>
) {
	return (Object.keys(workspaceDefinitions) as WorkspaceId[]).map(
		(workspaceId) => {
			const definition = workspaceDefinitions[workspaceId];

			return {
				current: workspaceId === current,
				href: urls[workspaceId],
				icon: definition.icon,
				label: definition.label,
				shortLabel: definition.shortLabel,
			};
		}
	);
}
