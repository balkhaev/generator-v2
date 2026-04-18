"use client";

import {
	type BaseModelFamily,
	getBaseModelFamily,
	getBaseModelLabel,
} from "@generator/contracts/base-models";
import type { WorkflowDefinition } from "@generator/studio-client/shared";
import { cn } from "@generator/ui/lib/utils";
import {
	Image as ImageIcon,
	ImagePlus,
	Sparkles,
	Type,
	Video,
} from "lucide-react";
import type { ReactNode } from "react";

import {
	type Approach,
	classifyWorkflow,
	type Modality,
} from "./workflow-matrix";

interface WorkflowGridProps {
	approach: Approach;
	availableApproaches: Approach[];
	availableModalities: Modality[];
	filteredWorkflows: WorkflowDefinition[];
	modality: Modality;
	onApproachChange: (approach: Approach) => void;
	onModalityChange: (modality: Modality) => void;
	onWorkflowChange: (workflowKey: string) => void;
	selectedWorkflowKey: string;
}

const modalityMeta: Record<
	Modality,
	{ icon: ReactNode; label: string; sublabel: string }
> = {
	image: {
		icon: <ImageIcon className="size-3.5" strokeWidth={1.6} />,
		label: "Image",
		sublabel: "Still picture",
	},
	video: {
		icon: <Video className="size-3.5" strokeWidth={1.6} />,
		label: "Video",
		sublabel: "Motion clip",
	},
};

const approachMeta: Record<
	Approach,
	{ icon: ReactNode; image: string; video: string }
> = {
	text: {
		icon: <Type className="size-3.5" strokeWidth={1.6} />,
		image: "From text",
		video: "From text",
	},
	image: {
		icon: <ImagePlus className="size-3.5" strokeWidth={1.6} />,
		image: "From image",
		video: "From image",
	},
};

const familyTints: Record<BaseModelFamily, string> = {
	flux: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
	qwen: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
	sdxl: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	sd: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
	"z-image": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	"image-other": "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
	video: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
	audio: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
	other: "bg-foreground/10 text-muted-foreground",
};

interface SegmentProps {
	active: boolean;
	disabled?: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
	sublabel: string;
}

function Segment({
	active,
	disabled,
	icon,
	label,
	onClick,
	sublabel,
}: SegmentProps) {
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
			type="button"
		>
			<span
				className={cn(
					"flex size-7 shrink-0 items-center justify-center rounded-md",
					active ? "bg-background/15" : "bg-foreground/[0.06]"
				)}
			>
				{icon}
			</span>
			<span className="grid min-w-0">
				<span className="truncate font-medium text-[12px] leading-tight">
					{label}
				</span>
				<span
					className={cn(
						"truncate text-[10px] leading-tight",
						active ? "text-background/70" : "text-muted-foreground"
					)}
				>
					{sublabel}
				</span>
			</span>
		</button>
	);
}

interface WorkflowCardProps {
	active: boolean;
	onClick: () => void;
	workflow: WorkflowDefinition;
}

function renderLoraBadge(classification: ReturnType<typeof classifyWorkflow>) {
	if (classification.requiresLora) {
		return (
			<span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 font-medium text-[10px] text-amber-600 dark:text-amber-400">
				<Sparkles aria-hidden="true" className="size-2.5" />
				LoRA
			</span>
		);
	}
	if (classification.hasLora) {
		return (
			<span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
				<Sparkles aria-hidden="true" className="size-2.5" />
				LoRA optional
			</span>
		);
	}
	return null;
}

function WorkflowCard({ active, onClick, workflow }: WorkflowCardProps) {
	const classification = classifyWorkflow(workflow);
	const baseModelId = workflow.baseModel ?? "other";
	const family = getBaseModelFamily(baseModelId);
	const modelLabel = getBaseModelLabel(baseModelId);

	return (
		<button
			aria-pressed={active}
			className={cn(
				"group relative grid min-w-0 gap-1.5 rounded-lg border p-3 text-left transition",
				active
					? "border-foreground bg-foreground/[0.04] ring-1 ring-foreground/30"
					: "border-foreground/10 bg-background hover:border-foreground/25 hover:bg-foreground/[0.02]"
			)}
			onClick={onClick}
			type="button"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<span
						className={cn(
							"flex size-7 shrink-0 items-center justify-center rounded-md font-medium text-[11px]",
							familyTints[family]
						)}
					>
						{modelLabel.slice(0, 2).toUpperCase()}
					</span>
					<div className="grid min-w-0">
						<span className="truncate font-medium text-[12px] leading-tight">
							{workflow.name}
						</span>
						<span className="truncate text-[10px] text-muted-foreground leading-tight">
							{modelLabel}
						</span>
					</div>
				</div>
				{renderLoraBadge(classification)}
			</div>
			<p className="line-clamp-2 text-[11px] text-muted-foreground leading-snug">
				{workflow.summary}
			</p>
		</button>
	);
}

export default function WorkflowGrid({
	approach,
	availableApproaches,
	availableModalities,
	filteredWorkflows,
	modality,
	onApproachChange,
	onModalityChange,
	onWorkflowChange,
	selectedWorkflowKey,
}: WorkflowGridProps) {
	return (
		<div className="grid gap-3">
			<div className="grid gap-2 sm:grid-cols-2">
				<div className="grid gap-1">
					<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
						Source
					</span>
					<div className="grid grid-cols-2 gap-1.5">
						{(["text", "image"] as const).map((value) => {
							const meta = approachMeta[value];
							const label = modality === "video" ? meta.video : meta.image;
							const isAvailable = availableApproaches.includes(value);
							return (
								<Segment
									active={approach === value}
									disabled={!isAvailable}
									icon={meta.icon}
									key={value}
									label={label}
									onClick={() => onApproachChange(value)}
									sublabel={
										value === "text" ? "Just a prompt" : "Reference image"
									}
								/>
							);
						})}
					</div>
				</div>
				<div className="grid gap-1">
					<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
						Output
					</span>
					<div className="grid grid-cols-2 gap-1.5">
						{(["image", "video"] as const).map((value) => {
							const meta = modalityMeta[value];
							const isAvailable = availableModalities.includes(value);
							return (
								<Segment
									active={modality === value}
									disabled={!isAvailable}
									icon={meta.icon}
									key={value}
									label={meta.label}
									onClick={() => onModalityChange(value)}
									sublabel={meta.sublabel}
								/>
							);
						})}
					</div>
				</div>
			</div>

			{filteredWorkflows.length === 0 ? (
				<p className="rounded-lg bg-foreground/[0.03] px-3 py-4 text-center text-[11px] text-muted-foreground">
					No workflows match this combination.
				</p>
			) : (
				<WorkflowGroups
					onWorkflowChange={onWorkflowChange}
					selectedWorkflowKey={selectedWorkflowKey}
					workflows={filteredWorkflows}
				/>
			)}
		</div>
	);
}

interface WorkflowGroupsProps {
	onWorkflowChange: (workflowKey: string) => void;
	selectedWorkflowKey: string;
	workflows: WorkflowDefinition[];
}

function WorkflowGroups({
	onWorkflowChange,
	selectedWorkflowKey,
	workflows,
}: WorkflowGroupsProps) {
	// Workflows where LoRA is optional are presented in the same list as
	// "base" workflows — adding a LoRA is just an extra step inside the
	// selected workflow's form. Only workflows that *require* a LoRA are
	// pulled into a separate group, since they can't be used without one.
	const base: WorkflowDefinition[] = [];
	const lora: WorkflowDefinition[] = [];
	for (const workflow of workflows) {
		if (classifyWorkflow(workflow).requiresLora) {
			lora.push(workflow);
		} else {
			base.push(workflow);
		}
	}

	return (
		<div className="grid gap-3">
			{base.length > 0 ? (
				<WorkflowGroup
					hint="LoRA-aware workflows accept an optional style LoRA."
					label="Models"
					onWorkflowChange={onWorkflowChange}
					selectedWorkflowKey={selectedWorkflowKey}
					workflows={base}
				/>
			) : null}
			{lora.length > 0 ? (
				<WorkflowGroup
					hint="These workflows require picking a LoRA."
					icon={
						<Sparkles aria-hidden="true" className="size-3 text-amber-500" />
					}
					label="LoRA-only"
					onWorkflowChange={onWorkflowChange}
					selectedWorkflowKey={selectedWorkflowKey}
					workflows={lora}
				/>
			) : null}
		</div>
	);
}

interface WorkflowGroupProps {
	hint: string;
	icon?: ReactNode;
	label: string;
	onWorkflowChange: (workflowKey: string) => void;
	selectedWorkflowKey: string;
	workflows: WorkflowDefinition[];
}

function WorkflowGroup({
	hint,
	icon,
	label,
	onWorkflowChange,
	selectedWorkflowKey,
	workflows,
}: WorkflowGroupProps) {
	return (
		<div className="grid gap-1.5">
			<div className="flex items-center justify-between gap-2">
				<span className="inline-flex items-center gap-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
					{icon}
					{label}
				</span>
				<span className="truncate text-[10px] text-muted-foreground/70">
					{hint}
				</span>
			</div>
			<div className="grid gap-1.5 sm:grid-cols-2">
				{workflows.map((workflow) => (
					<WorkflowCard
						active={workflow.key === selectedWorkflowKey}
						key={workflow.key}
						onClick={() => onWorkflowChange(workflow.key)}
						workflow={workflow}
					/>
				))}
			</div>
		</div>
	);
}
