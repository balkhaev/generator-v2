"use client";

import {
	createScenarioFormState,
	type ScenarioFormState,
	type WorkflowDefinition,
	type WorkflowParameter,
} from "@generator/studio-client/shared";
import { SectionLabel } from "@generator/ui/components/section-label";
import { cn } from "@generator/ui/lib/utils";
import { BadgeInfo, ImagePlus, Sparkles, Type, Video } from "lucide-react";
import type { ReactNode } from "react";

import ParameterField from "./parameter-field";

export const CIVITAI_LTX23_TEXT_WORKFLOW_KEY =
	"civitai-ltx-2-3-synth-text-to-video";
export const CIVITAI_LTX23_IMAGE_WORKFLOW_KEY =
	"civitai-ltx-2-3-synth-image-to-video";

const CIVITAI_LTX23_WORKFLOW_KEYS = new Set([
	CIVITAI_LTX23_TEXT_WORKFLOW_KEY,
	CIVITAI_LTX23_IMAGE_WORKFLOW_KEY,
]);

const transferableParamKeys = [
	"aspectRatio",
	"duration",
	"generateAudio",
	"guidanceScale",
	"loraStrength",
	"resolution",
	"seed",
	"steps",
] as const;

type CivitaiMode = "text" | "image";

const modeMeta: Record<
	CivitaiMode,
	{ icon: ReactNode; label: string; workflowKey: string }
> = {
	image: {
		icon: <ImagePlus className="size-3" />,
		label: "I2V",
		workflowKey: CIVITAI_LTX23_IMAGE_WORKFLOW_KEY,
	},
	text: {
		icon: <Type className="size-3" />,
		label: "T2V",
		workflowKey: CIVITAI_LTX23_TEXT_WORKFLOW_KEY,
	},
};

export function isCivitaiLtx23Workflow(
	workflow: Pick<WorkflowDefinition, "key">
) {
	return CIVITAI_LTX23_WORKFLOW_KEYS.has(workflow.key);
}

export function createCivitaiLtx23FormState(
	workflow: WorkflowDefinition,
	current?: ScenarioFormState | null
): ScenarioFormState {
	const base = createScenarioFormState(workflow);
	if (!current) {
		return base;
	}

	const params = { ...base.params };
	for (const key of transferableParamKeys) {
		const value = current.params[key];
		if (typeof value === "string") {
			params[key] = value;
		}
	}
	if (workflow.requiresInputImage) {
		const endImageUrl = current.params.endImageUrl;
		if (typeof endImageUrl === "string") {
			params.endImageUrl = endImageUrl;
		}
	}

	return {
		...base,
		name: current.name,
		params,
		prompt: current.prompt,
		promptSource: current.promptSource ?? null,
	};
}

function findParameter(
	workflow: WorkflowDefinition,
	key: string
): WorkflowParameter | null {
	return workflow.parameters.find((parameter) => parameter.key === key) ?? null;
}

function getParamValue(
	form: ScenarioFormState,
	parameter: WorkflowParameter | null
) {
	if (!parameter) {
		return "";
	}
	return form.params[parameter.key] ?? parameter.defaultValue;
}

function CivitaiPill({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground">
			{children}
		</span>
	);
}

function SegmentedControl<TValue extends string>({
	columns = 2,
	label,
	onChange,
	options,
	value,
}: {
	columns?: number;
	label: string;
	onChange: (next: TValue) => void;
	options: readonly { icon?: ReactNode; label: string; value: TValue }[];
	value: TValue;
}) {
	return (
		<div className="grid gap-1.5">
			<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
				{label}
			</span>
			<div
				className="grid gap-1"
				style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
			>
				{options.map((option) => {
					const active = value === option.value;
					return (
						<button
							aria-pressed={active}
							className={cn(
								"inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-md px-2 text-[11px] transition",
								active
									? "bg-foreground text-background"
									: "bg-foreground/[0.05] text-muted-foreground hover:bg-foreground/[0.09] hover:text-foreground"
							)}
							key={option.value}
							onClick={() => onChange(option.value)}
							type="button"
						>
							{option.icon}
							<span className="truncate">{option.label}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

function SegmentedParameterField({
	columns,
	labels,
	onParamChange,
	parameter,
	value,
}: {
	columns?: number;
	labels?: Record<string, string>;
	onParamChange: (key: string, value: string) => void;
	parameter: WorkflowParameter | null;
	value: string;
}) {
	if (!(parameter?.enumValues && parameter.enumValues.length > 0)) {
		return null;
	}
	return (
		<SegmentedControl
			columns={columns}
			label={parameter.label}
			onChange={(next) => onParamChange(parameter.key, next)}
			options={parameter.enumValues.map((option) => ({
				label: labels?.[option] ?? option,
				value: option,
			}))}
			value={value || parameter.defaultValue || parameter.enumValues[0]}
		/>
	);
}

function CivitaiParameterField({
	form,
	onParamChange,
	parameter,
}: {
	form: ScenarioFormState;
	onParamChange: (key: string, value: string) => void;
	parameter: WorkflowParameter | null;
}) {
	if (!parameter) {
		return null;
	}
	return (
		<ParameterField
			onChange={(value) => onParamChange(parameter.key, value)}
			parameter={parameter}
			value={getParamValue(form, parameter)}
		/>
	);
}

export default function CivitaiLtx23Setup({
	form,
	onParamChange,
	onWorkflowChange,
	selectedWorkflow,
	workflows,
}: {
	form: ScenarioFormState;
	onParamChange: (key: string, value: string) => void;
	onWorkflowChange: (workflowKey: string) => void;
	selectedWorkflow: WorkflowDefinition;
	workflows: WorkflowDefinition[];
}) {
	const civitaiWorkflows = workflows.filter(isCivitaiLtx23Workflow);
	const mode: CivitaiMode = selectedWorkflow.requiresInputImage
		? "image"
		: "text";
	const sourceOptions = (["text", "image"] as const)
		.map((value) => ({
			...modeMeta[value],
			value,
		}))
		.filter((option) =>
			civitaiWorkflows.some((workflow) => workflow.key === option.workflowKey)
		);

	const aspectRatio = findParameter(selectedWorkflow, "aspectRatio");
	const duration = findParameter(selectedWorkflow, "duration");
	const endImageUrl = findParameter(selectedWorkflow, "endImageUrl");
	const generateAudio = findParameter(selectedWorkflow, "generateAudio");
	const guidanceScale = findParameter(selectedWorkflow, "guidanceScale");
	const loraStrength = findParameter(selectedWorkflow, "loraStrength");
	const resolution = findParameter(selectedWorkflow, "resolution");
	const seed = findParameter(selectedWorkflow, "seed");
	const steps = findParameter(selectedWorkflow, "steps");

	return (
		<section className="grid min-w-0 gap-3 rounded-lg bg-foreground/[0.03] p-3 ring-1 ring-foreground/6">
			<div className="flex min-w-0 items-start justify-between gap-2">
				<div className="grid min-w-0 gap-1">
					<div className="flex min-w-0 items-center gap-1.5">
						<Video className="size-3.5 text-muted-foreground" />
						<SectionLabel>Civitai inference</SectionLabel>
					</div>
					<div className="flex min-w-0 flex-wrap items-center gap-1">
						<CivitaiPill>
							<Sparkles className="size-2.5" />
							Synth LoRA 2509189@2820451
						</CivitaiPill>
						<CivitaiPill>LTX 2.3 · 22B dev</CivitaiPill>
					</div>
				</div>
				<CivitaiPill>{mode.toUpperCase()}</CivitaiPill>
			</div>

			<SegmentedControl
				label="Source"
				onChange={(nextMode) => {
					const nextWorkflowKey = modeMeta[nextMode].workflowKey;
					if (nextWorkflowKey !== selectedWorkflow.key) {
						onWorkflowChange(nextWorkflowKey);
					}
				}}
				options={sourceOptions}
				value={mode}
			/>

			{selectedWorkflow.requiresInputImage ? (
				<div className="flex min-w-0 items-center gap-1.5 rounded-lg bg-foreground/[0.04] px-2.5 py-2 text-[11px] text-muted-foreground">
					<BadgeInfo className="size-3 shrink-0" />
					<span className="min-w-0 truncate">First frame: launch input</span>
				</div>
			) : null}

			<div className="grid gap-3 sm:grid-cols-2">
				<SegmentedParameterField
					labels={{ "1080p": "1080p", "720p": "720p" }}
					onParamChange={onParamChange}
					parameter={resolution}
					value={getParamValue(form, resolution)}
				/>
				<SegmentedParameterField
					columns={5}
					onParamChange={onParamChange}
					parameter={aspectRatio}
					value={getParamValue(form, aspectRatio)}
				/>
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<CivitaiParameterField
					form={form}
					onParamChange={onParamChange}
					parameter={duration}
				/>
				<SegmentedParameterField
					labels={{ false: "Audio off", true: "Audio on" }}
					onParamChange={onParamChange}
					parameter={generateAudio}
					value={getParamValue(form, generateAudio)}
				/>
			</div>

			{selectedWorkflow.requiresInputImage ? (
				<CivitaiParameterField
					form={form}
					onParamChange={onParamChange}
					parameter={endImageUrl}
				/>
			) : null}

			<div className="grid gap-3 sm:grid-cols-2">
				<CivitaiParameterField
					form={form}
					onParamChange={onParamChange}
					parameter={steps}
				/>
				<CivitaiParameterField
					form={form}
					onParamChange={onParamChange}
					parameter={guidanceScale}
				/>
				<CivitaiParameterField
					form={form}
					onParamChange={onParamChange}
					parameter={loraStrength}
				/>
				<CivitaiParameterField
					form={form}
					onParamChange={onParamChange}
					parameter={seed}
				/>
			</div>
		</section>
	);
}
