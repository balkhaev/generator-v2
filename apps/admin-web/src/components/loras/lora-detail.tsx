"use client";

import { getBaseModelLabel } from "@generator/contracts/base-models";
import type { LoraRegistryEntry } from "@generator/contracts/loras";
import { EmptyState } from "@generator/ui/components/empty-state";
import { SectionLabel } from "@generator/ui/components/section-label";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { formatBytes, formatDateTime } from "@generator/ui/lib/format";
import { ExternalLink, Tags } from "lucide-react";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="grid gap-1">
			<SectionLabel>{label}</SectionLabel>
			<div className="break-all text-xs">{value}</div>
		</div>
	);
}

export default function LoraDetail({
	lora,
}: {
	lora: LoraRegistryEntry | null;
}) {
	if (!lora) {
		return (
			<div className="grid h-full place-items-center px-4 py-8">
				<EmptyState
					hint="Select an entry on the left to inspect its metadata."
					icon={Tags}
					message="No LoRA selected"
				/>
			</div>
		);
	}

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
			<div className="border-foreground/6 border-b px-4 py-3 dark:border-foreground/10">
				<SectionLabel>Inspector</SectionLabel>
			</div>
			<div className="grid min-h-0 gap-4 overflow-y-auto px-4 py-4">
				<div className="grid gap-1.5">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="font-medium text-sm">{lora.name}</h3>
						<StatusBadge
							tone={lora.status === "active" ? "success" : "warning"}
						>
							{lora.status}
						</StatusBadge>
					</div>
					{lora.description ? (
						<p className="text-muted-foreground text-xs">{lora.description}</p>
					) : null}
				</div>

				<div className="grid gap-3">
					<Field label="Slug" value={<code>{lora.slug}</code>} />
					<Field label="Base model" value={getBaseModelLabel(lora.baseModel)} />
					{lora.sourceProvider ? (
						<Field label="Source provider" value={lora.sourceProvider} />
					) : null}
					<Field label="Default weight" value={lora.defaultWeight} />
					<Field label="Size" value={formatBytes(lora.sizeBytes)} />
					<Field
						label="S3 URL"
						value={
							<a
								className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
								href={lora.s3Url}
								rel="noopener noreferrer"
								target="_blank"
							>
								<span className="break-all">{lora.s3Url}</span>
								<ExternalLink className="size-3" />
							</a>
						}
					/>
					<Field
						label="S3 key"
						value={<code className="text-[11px]">{lora.s3Key}</code>}
					/>
					{lora.sourceUrl ? (
						<Field
							label="Source"
							value={
								<a
									className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
									href={lora.sourceUrl}
									rel="noopener noreferrer"
									target="_blank"
								>
									<span className="break-all">{lora.sourceUrl}</span>
									<ExternalLink className="size-3" />
								</a>
							}
						/>
					) : null}
					<Field label="Created" value={formatDateTime(lora.createdAt)} />
					<Field label="Updated" value={formatDateTime(lora.updatedAt)} />
				</div>
			</div>
		</div>
	);
}
