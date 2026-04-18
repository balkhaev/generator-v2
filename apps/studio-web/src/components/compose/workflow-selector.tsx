"use client";

import {
	type BaseModelFamily,
	getBaseModelFamily,
	getBaseModelLabel,
} from "@generator/contracts/base-models";
import type { WorkflowDefinition } from "@generator/studio-client/shared";
import { cn } from "@generator/ui/lib/utils";
import { Film, Image as ImageIcon, ImagePlus, Type, Video } from "lucide-react";
import type { ReactNode } from "react";

import type { Approach, Modality } from "./workflow-matrix";

interface WorkflowSelectorProps {
	approach: Approach;
	availableApproaches: Approach[];
	availableBaseModels: string[];
	availableModalities: Modality[];
	availableVariants: WorkflowDefinition[];
	baseModel: string | null;
	modality: Modality;
	onApproachChange: (approach: Approach) => void;
	onBaseModelChange: (baseModel: string) => void;
	onModalityChange: (modality: Modality) => void;
	onVariantChange: (workflowKey: string) => void;
	selectedWorkflowKey: string;
}

interface ChipProps {
	active: boolean;
	disabled?: boolean;
	icon?: ReactNode;
	label: string;
	onClick: () => void;
	sublabel?: string;
	title?: string;
}

function Chip({
	active,
	disabled,
	icon,
	label,
	onClick,
	sublabel,
	title,
}: ChipProps) {
	return (
		<button
			aria-pressed={active}
			className={cn(
				"flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition",
				active
					? "border-foreground bg-foreground text-background"
					: "border-foreground/10 bg-foreground/[0.03] text-foreground hover:border-foreground/20 hover:bg-foreground/[0.06]",
				disabled && "cursor-not-allowed opacity-40"
			)}
			disabled={disabled}
			onClick={onClick}
			title={title}
			type="button"
		>
			{icon ? (
				<span
					className={cn(
						"flex size-7 shrink-0 items-center justify-center rounded-md",
						active ? "bg-background/15" : "bg-foreground/[0.06]"
					)}
				>
					{icon}
				</span>
			) : null}
			<span className="grid min-w-0">
				<span className="truncate font-medium text-[12px] leading-tight">
					{label}
				</span>
				{sublabel ? (
					<span
						className={cn(
							"truncate text-[10px] leading-tight",
							active ? "text-background/70" : "text-muted-foreground"
						)}
					>
						{sublabel}
					</span>
				) : null}
			</span>
		</button>
	);
}

const modalityMeta: Record<Modality, { icon: ReactNode; label: string }> = {
	image: {
		icon: <ImageIcon className="size-3.5" strokeWidth={1.6} />,
		label: "Image",
	},
	video: {
		icon: <Video className="size-3.5" strokeWidth={1.6} />,
		label: "Video",
	},
};

const approachMeta: Record<
	Approach,
	{ icon: ReactNode; image: string; video: string }
> = {
	text: {
		icon: <Type className="size-3.5" strokeWidth={1.6} />,
		image: "Text → image",
		video: "Text → video",
	},
	image: {
		icon: <ImagePlus className="size-3.5" strokeWidth={1.6} />,
		image: "Image → image",
		video: "Image → video",
	},
};

const baseModelTintsByFamily: Record<BaseModelFamily, string> = {
	flux: "text-violet-500",
	sdxl: "text-amber-500",
	sd: "text-sky-500",
	"z-image": "text-emerald-500",
	"image-other": "text-fuchsia-500",
	video: "text-rose-500",
	other: "text-muted-foreground",
};

export default function WorkflowSelector({
	approach,
	availableApproaches,
	availableBaseModels,
	availableModalities,
	availableVariants,
	baseModel,
	modality,
	onApproachChange,
	onBaseModelChange,
	onModalityChange,
	onVariantChange,
	selectedWorkflowKey,
}: WorkflowSelectorProps) {
	const showVariants = availableVariants.length > 1;
	return (
		<div className="grid gap-3">
			<div className="grid gap-1">
				<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
					Output
				</span>
				<div className="grid grid-cols-2 gap-1.5">
					{(["image", "video"] as const).map((value) => {
						const meta = modalityMeta[value];
						const isAvailable = availableModalities.includes(value);
						return (
							<Chip
								active={modality === value}
								disabled={!isAvailable}
								icon={meta.icon}
								key={value}
								label={meta.label}
								onClick={() => onModalityChange(value)}
							/>
						);
					})}
				</div>
			</div>

			<div className="grid gap-1">
				<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
					Input
				</span>
				<div className="grid grid-cols-2 gap-1.5">
					{(["text", "image"] as const).map((value) => {
						const meta = approachMeta[value];
						const label = modality === "video" ? meta.video : meta.image;
						const isAvailable = availableApproaches.includes(value);
						return (
							<Chip
								active={approach === value}
								disabled={!isAvailable}
								icon={meta.icon}
								key={value}
								label={label}
								onClick={() => onApproachChange(value)}
							/>
						);
					})}
				</div>
			</div>

			<div className="grid gap-1">
				<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
					Model
				</span>
				{availableBaseModels.length > 0 ? (
					<div className="flex flex-wrap gap-1.5">
						{availableBaseModels.map((model) => {
							const tint = baseModelTintsByFamily[getBaseModelFamily(model)];
							return (
								<Chip
									active={baseModel === model}
									icon={
										<Film
											className={cn(
												"size-3.5",
												baseModel === model ? "" : tint
											)}
											strokeWidth={1.6}
										/>
									}
									key={model}
									label={getBaseModelLabel(model)}
									onClick={() => onBaseModelChange(model)}
								/>
							);
						})}
					</div>
				) : (
					<p className="rounded-lg bg-foreground/[0.03] px-3 py-2 text-[11px] text-muted-foreground">
						No models support this combination.
					</p>
				)}
			</div>

			{showVariants ? (
				<div className="grid gap-1">
					<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
						Variant
					</span>
					<div className="flex flex-wrap gap-1.5">
						{availableVariants.map((variant) => (
							<Chip
								active={variant.key === selectedWorkflowKey}
								key={variant.key}
								label={variant.name}
								onClick={() => onVariantChange(variant.key)}
								title={variant.summary}
							/>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
