"use client";

import { Button } from "@generator/ui/components/button";
import { Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
	useAssetReleasePresets,
	useProvisionPreset,
} from "@/hooks/use-asset-releases";
import type { AssetReleaseSnapshot } from "@/lib/asset-releases-client";

export default function PresetList({
	onProvisioned,
}: {
	onProvisioned: (releases: AssetReleaseSnapshot[]) => void;
}) {
	const { data: presets = [] } = useAssetReleasePresets();
	const provision = useProvisionPreset();
	const [pending, setPending] = useState<string | null>(null);

	if (presets.length === 0) {
		return null;
	}

	async function handleProvision(presetId: string) {
		setPending(presetId);
		try {
			const result = await provision.mutateAsync(presetId);
			onProvisioned(result.releases);
			toast.success(`Provisioned preset: ${result.preset.name}`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to provision preset."
			);
		} finally {
			setPending(null);
		}
	}

	return (
		<div className="grid gap-3 rounded-lg border border-foreground/8 bg-background/40 p-4 dark:bg-background/20">
			<div className="grid gap-1">
				<p className="font-medium text-sm">Preset bundles</p>
				<p className="text-muted-foreground text-xs">
					One-click rollout from a canonical source.
				</p>
			</div>
			{presets.map((preset) => (
				<div
					className="grid gap-2 rounded-md bg-muted/15 px-3 py-3 dark:bg-muted/8"
					key={preset.id}
				>
					<p className="font-medium text-xs">{preset.name}</p>
					<p className="text-muted-foreground text-xs">{preset.description}</p>
					<p className="text-[11px] text-muted-foreground">
						Bundle:{" "}
						{preset.assets
							.map((asset) => `${asset.group}/${asset.fileName}`)
							.join(", ")}
					</p>
					<div className="flex items-center gap-2">
						<Button
							disabled={pending === preset.id}
							onClick={() => handleProvision(preset.id)}
							size="sm"
							type="button"
							variant="outline"
						>
							{pending === preset.id ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<Upload className="size-3.5" />
							)}
							Provision
						</Button>
						<a
							className="text-xs underline-offset-4 hover:underline"
							href={preset.sourceUrl}
							rel="noreferrer noopener"
							target="_blank"
						>
							Open source
						</a>
					</div>
				</div>
			))}
		</div>
	);
}
