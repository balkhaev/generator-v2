import {
	Bookmark,
	Clapperboard,
	type LucideIcon,
	ShieldEllipsis,
	UsersRound,
} from "lucide-react";

export type WorkspaceId = "admin" | "persons" | "shots" | "studio";

export interface WorkspaceAccent {
	/** oklch chroma for the accent (saturation). */
	chroma: number;
	/** Foreground tone used when the accent is rendered as a solid surface. */
	foreground: string;
	/** oklch hue (0–360) describing the dominant accent color. */
	hue: number;
	/** oklch lightness for the accent in light mode. */
	lightness: number;
	/** oklch lightness for the accent in dark mode. */
	lightnessDark: number;
}

interface WorkspaceDefinition {
	accent: WorkspaceAccent;
	icon: LucideIcon;
	label: string;
	shortLabel: string;
}

const workspaceDefinitions: Record<WorkspaceId, WorkspaceDefinition> = {
	studio: {
		accent: {
			chroma: 0.12,
			foreground: "oklch(0.99 0 0)",
			hue: 205,
			lightness: 0.58,
			lightnessDark: 0.68,
		},
		icon: Clapperboard,
		label: "Studio",
		shortLabel: "Std",
	},
	persons: {
		accent: {
			chroma: 0.14,
			foreground: "oklch(0.18 0 0)",
			hue: 78,
			lightness: 0.78,
			lightnessDark: 0.74,
		},
		icon: UsersRound,
		label: "Persons",
		shortLabel: "Cast",
	},
	shots: {
		accent: {
			chroma: 0.16,
			foreground: "oklch(0.99 0 0)",
			hue: 320,
			lightness: 0.62,
			lightnessDark: 0.68,
		},
		icon: Bookmark,
		label: "Shots",
		shortLabel: "Sht",
	},
	admin: {
		accent: {
			chroma: 0.12,
			foreground: "oklch(0.99 0 0)",
			hue: 230,
			lightness: 0.58,
			lightnessDark: 0.66,
		},
		icon: ShieldEllipsis,
		label: "Admin",
		shortLabel: "Adm",
	},
};

export interface WorkspaceNavEntry {
	accent: WorkspaceAccent;
	current: boolean;
	href: string;
	icon: LucideIcon;
	label: string;
	shortLabel: string;
	workspaceId: WorkspaceId;
}

export function createWorkspaceNavigation(
	current: WorkspaceId,
	urls: Record<WorkspaceId, string>
): WorkspaceNavEntry[] {
	return (Object.keys(workspaceDefinitions) as WorkspaceId[]).map(
		(workspaceId) => {
			const definition = workspaceDefinitions[workspaceId];

			return {
				accent: definition.accent,
				current: workspaceId === current,
				href: urls[workspaceId],
				icon: definition.icon,
				label: definition.label,
				shortLabel: definition.shortLabel,
				workspaceId,
			};
		}
	);
}

export function getWorkspaceAccent(workspaceId: WorkspaceId): WorkspaceAccent {
	return workspaceDefinitions[workspaceId].accent;
}
