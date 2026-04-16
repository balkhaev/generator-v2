"use client";

import { Button } from "@generator/ui/components/button";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { formatBytes } from "@generator/ui/lib/format";
import { Loader2, Upload } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
	type AssetReleaseGroup,
	type AssetReleaseSnapshot,
	uploadAssetRelease,
} from "@/lib/asset-releases-client";

const groupOptions = [
	{ value: "workflows", label: "Workflows" },
	{ value: "models", label: "Models" },
	{ value: "loras", label: "Loras" },
	{ value: "vae", label: "VAE" },
	{ value: "checkpoints", label: "Checkpoints" },
] as const;

const selectClassName =
	"flex h-9 w-full rounded-md border border-foreground/10 bg-transparent px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

export default function ReleaseForm({
	onCreated,
}: {
	onCreated: (release: AssetReleaseSnapshot) => void;
}) {
	const [label, setLabel] = useState("");
	const [group, setGroup] = useState<AssetReleaseGroup>("workflows");
	const [files, setFiles] = useState<File[]>([]);
	const [uploadProgressPct, setUploadProgressPct] = useState(0);
	const [isUploading, setIsUploading] = useState(false);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (files.length === 0) {
			toast.error("Select at least one file.");
			return;
		}

		setIsUploading(true);
		setUploadProgressPct(0);

		try {
			const release = await uploadAssetRelease({
				files,
				group,
				label: label.trim() || `${group} release ${new Date().toISOString()}`,
				onProgress: setUploadProgressPct,
			});

			onCreated(release);
			setFiles([]);
			setLabel("");
			toast.success("Release uploaded. Volume sync has started.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to create release."
			);
		} finally {
			setIsUploading(false);
		}
	}

	return (
		<form
			className="grid gap-3 rounded-lg border border-foreground/8 bg-background/40 p-4 dark:bg-background/20"
			onSubmit={handleSubmit}
		>
			<div className="grid gap-2">
				<Label htmlFor="release-label">Release label</Label>
				<Input
					id="release-label"
					onChange={(event) => setLabel(event.target.value)}
					placeholder="workflow bundle 2026-04-04"
					value={label}
				/>
			</div>
			<div className="grid gap-2">
				<Label htmlFor="release-group">Volume target</Label>
				<select
					className={selectClassName}
					id="release-group"
					onChange={(event) =>
						setGroup(event.target.value as AssetReleaseGroup)
					}
					value={group}
				>
					{groupOptions.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
				<p className="text-muted-foreground text-xs">
					Writes into the canonical{" "}
					<code className="rounded bg-muted/20 px-1 py-0.5 dark:bg-muted/10">
						{group}/
					</code>{" "}
					lane.
				</p>
			</div>
			<div className="grid gap-2">
				<Label htmlFor="release-files">Files</Label>
				<Input
					id="release-files"
					multiple
					onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
					type="file"
				/>
				<p className="text-muted-foreground text-xs">
					Selected {files.length} files,{" "}
					{formatBytes(files.reduce((total, file) => total + file.size, 0))}
				</p>
			</div>
			{isUploading ? (
				<div className="grid gap-2">
					<div className="flex items-center justify-between text-xs">
						<span className="text-muted-foreground">Upload to gateway</span>
						<span className="tabular-nums">{uploadProgressPct}%</span>
					</div>
					<div className="h-1.5 overflow-hidden rounded-full bg-foreground/8">
						<div
							className="h-full rounded-full bg-foreground transition-[width]"
							style={{ width: `${uploadProgressPct}%` }}
						/>
					</div>
				</div>
			) : null}
			<Button disabled={isUploading} type="submit">
				{isUploading ? (
					<Loader2 className="size-3.5 animate-spin" />
				) : (
					<Upload className="size-3.5" />
				)}
				Create release
			</Button>
		</form>
	);
}
