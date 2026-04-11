"use client";

import { SectionLabel } from "@generator/ui/components/section-label";

import AssetReleaseConsole from "@/components/asset-release-console";

export default function AdminInspector() {
	return (
		<div className="grid h-full min-h-0 gap-3 xl:grid-rows-[auto_minmax(0,1fr)]">
			<section className="min-h-0 overflow-hidden rounded-lg bg-background/80 backdrop-blur-xl dark:bg-background/60">
				<div className="flex items-center justify-between gap-3 px-3 py-2.5">
					<SectionLabel>Inspector</SectionLabel>
				</div>
			</section>

			<div className="min-h-0">
				<AssetReleaseConsole />
			</div>
		</div>
	);
}
