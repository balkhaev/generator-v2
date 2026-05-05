"use client";

import type { LoraSourcePreview } from "@generator/contracts/loras";
import { previewStudioLoraSource } from "@generator/studio-client/client";
import {
	createScenarioFormState,
	type ScenarioFormState,
	type WorkflowDefinition,
	type WorkflowParameter,
} from "@generator/studio-client/shared";
import { Button } from "@generator/ui/components/button";
import { Input } from "@generator/ui/components/input";
import { SectionLabel } from "@generator/ui/components/section-label";
import { cn } from "@generator/ui/lib/utils";
import {
	AlertCircle,
	BadgeInfo,
	CheckCircle2,
	ExternalLink,
	Eye,
	ImagePlus,
	Loader2,
	RefreshCcw,
	Type,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

import ParameterField from "./parameter-field";

export const CIVITAI_LTX23_TEXT_WORKFLOW_KEY =
	"civitai-ltx-2-3-synth-text-to-video";
export const CIVITAI_LTX23_IMAGE_WORKFLOW_KEY =
	"civitai-ltx-2-3-synth-image-to-video";

const CIVITAI_LTX23_WORKFLOW_KEYS = new Set([
	CIVITAI_LTX23_TEXT_WORKFLOW_KEY,
	CIVITAI_LTX23_IMAGE_WORKFLOW_KEY,
]);

const CIVITAI_LTX23_DEFAULT_LORA = {
	air: "urn:air:ltxv23:lora:civitai:2509189@2820451",
	baseModel: "ltx-2-3",
	modelId: "2509189",
	name: "Synth Pussy - LTX 2.3",
	sourceUrl:
		"https://civitai.com/models/2509189/synth-pussy-ltx-23?modelVersionId=2820451",
	supportsGeneration: "true",
	triggerWords: "",
	versionId: "2820451",
} as const;

const transferableParamKeys = [
	"aspectRatio",
	"duration",
	"generateAudio",
	"guidanceScale",
	"loraAir",
	"loraBaseModel",
	"loraModelId",
	"loraName",
	"loraSourceUrl",
	"loraStrength",
	"loraSupportsGeneration",
	"loraTriggerWords",
	"loraVersionId",
	"resolution",
	"seed",
	"steps",
] as const;

type CivitaiMode = "text" | "image";

interface CivitaiLoraMetadata {
	air: string;
	baseModel: string;
	modelId: number;
	name: string;
	sourceUrl: string;
	supportsGeneration: boolean | null;
	triggerWords: string[];
	versionId: number;
	versionName: string;
}

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

function getParamText(form: ScenarioFormState, key: string) {
	return form.params[key]?.trim() ?? "";
}

function parsePositiveInteger(value: string): number | null {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseModelIdFromCivitaiUrl(value: string): number | null {
	try {
		const url = new URL(value);
		const segments = url.pathname.split("/").filter(Boolean);
		if (segments[0] !== "models") {
			return null;
		}
		return parsePositiveInteger(segments[1] ?? "");
	} catch {
		return null;
	}
}

function buildCivitaiLtx23Air(modelId: number, versionId: number) {
	return `urn:air:ltxv23:lora:civitai:${modelId}@${versionId}`;
}

function splitTriggerWords(value: string): string[] {
	return value
		.split(",")
		.map((word) => word.trim())
		.filter(Boolean);
}

function pickPreviewVersion(
	preview: LoraSourcePreview,
	versionId: number | null
) {
	if (!(preview.variants && preview.variants.length > 0)) {
		return null;
	}
	if (versionId !== null) {
		return (
			preview.variants.find((variant) => variant.versionId === versionId) ??
			null
		);
	}
	return (
		preview.variants.find(
			(variant) => variant.versionId === preview.sourceVersionId
		) ??
		preview.variants[0] ??
		null
	);
}

function buildMetadataFromPreview(input: {
	preview: LoraSourcePreview;
	sourceUrl: string;
	versionId: number | null;
}): CivitaiLoraMetadata | null {
	const version = pickPreviewVersion(input.preview, input.versionId);
	const modelId =
		input.preview.modelId ?? parseModelIdFromCivitaiUrl(input.sourceUrl);
	const sourceVersionId = version?.versionId ?? input.preview.sourceVersionId;
	if (!(modelId && sourceVersionId)) {
		return null;
	}
	const baseModel = version?.baseModel ?? input.preview.baseModel ?? "";
	return {
		air: buildCivitaiLtx23Air(modelId, sourceVersionId),
		baseModel,
		modelId,
		name: input.preview.name ?? "Civitai LoRA",
		sourceUrl: input.sourceUrl,
		supportsGeneration: input.preview.supportsGeneration ?? null,
		triggerWords: version?.trainedWords ?? input.preview.trainedWords ?? [],
		versionId: sourceVersionId,
		versionName: version?.versionName ?? input.preview.versionName ?? "Version",
	};
}

function getActiveMetadata(form: ScenarioFormState): CivitaiLoraMetadata {
	const modelId =
		parsePositiveInteger(getParamText(form, "loraModelId")) ??
		Number(CIVITAI_LTX23_DEFAULT_LORA.modelId);
	const versionId =
		parsePositiveInteger(getParamText(form, "loraVersionId")) ??
		Number(CIVITAI_LTX23_DEFAULT_LORA.versionId);
	const supportsGenerationRaw = getParamText(form, "loraSupportsGeneration");
	return {
		air: getParamText(form, "loraAir") || CIVITAI_LTX23_DEFAULT_LORA.air,
		baseModel:
			getParamText(form, "loraBaseModel") ||
			CIVITAI_LTX23_DEFAULT_LORA.baseModel,
		modelId,
		name: getParamText(form, "loraName") || CIVITAI_LTX23_DEFAULT_LORA.name,
		sourceUrl:
			getParamText(form, "loraSourceUrl") ||
			CIVITAI_LTX23_DEFAULT_LORA.sourceUrl,
		supportsGeneration:
			supportsGenerationRaw === "" ? null : supportsGenerationRaw === "true",
		triggerWords: splitTriggerWords(getParamText(form, "loraTriggerWords")),
		versionId,
		versionName: `Version ${versionId}`,
	};
}

function isLtx23Compatible(baseModel: string) {
	return baseModel === "ltx-2-3";
}

function applyLoraMetadata(
	metadata: CivitaiLoraMetadata,
	onParamChange: (key: string, value: string) => void
) {
	onParamChange("loraSourceUrl", metadata.sourceUrl);
	onParamChange("loraAir", metadata.air);
	onParamChange("loraModelId", String(metadata.modelId));
	onParamChange("loraVersionId", String(metadata.versionId));
	onParamChange("loraName", metadata.name);
	onParamChange("loraBaseModel", metadata.baseModel);
	onParamChange(
		"loraSupportsGeneration",
		metadata.supportsGeneration === false ? "false" : "true"
	);
	onParamChange("loraTriggerWords", metadata.triggerWords.join(", "));
}

function CivitaiPill({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex min-w-0 max-w-full items-center gap-1 truncate rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground">
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
	const optionCount = parameter.enumValues.length;
	const resolvedColumns =
		columns ?? (optionCount > 6 ? 3 : Math.max(2, optionCount));
	const selectedValue = parameter.enumValues.includes(value)
		? value
		: parameter.defaultValue || parameter.enumValues[0] || "";
	return (
		<SegmentedControl
			columns={resolvedColumns}
			label={parameter.label}
			onChange={(next) => onParamChange(parameter.key, next)}
			options={parameter.enumValues.map((option) => ({
				label:
					labels?.[option] ??
					(parameter.unit ? `${option}${parameter.unit}` : option),
				value: option,
			}))}
			value={selectedValue}
		/>
	);
}

function CompatibilityPill({
	compatible,
	supportsGeneration,
}: {
	compatible: boolean;
	supportsGeneration: boolean | null;
}) {
	if (!compatible) {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-700 dark:text-rose-300">
				<AlertCircle className="size-2.5" />
				Not LTXV 2.3
			</span>
		);
	}
	if (supportsGeneration === false) {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
				<AlertCircle className="size-2.5" />
				Generation off
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
			<CheckCircle2 className="size-2.5" />
			LTXV 2.3 ready
		</span>
	);
}

function CivitaiLoraCard({ metadata }: { metadata: CivitaiLoraMetadata }) {
	const compatible = isLtx23Compatible(metadata.baseModel);
	return (
		<div className="grid gap-2 rounded-lg bg-foreground/[0.035] p-2.5">
			<div className="flex min-w-0 items-start justify-between gap-2">
				<div className="grid min-w-0 gap-1">
					<p className="truncate font-medium text-[12px]">{metadata.name}</p>
					<div className="flex min-w-0 flex-wrap items-center gap-1">
						<CivitaiPill>
							<code className="min-w-0 truncate">{metadata.air}</code>
						</CivitaiPill>
						<CivitaiPill>{metadata.baseModel || "unknown base"}</CivitaiPill>
					</div>
				</div>
				<CompatibilityPill
					compatible={compatible}
					supportsGeneration={metadata.supportsGeneration}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
				<span>model {metadata.modelId}</span>
				<span>version {metadata.versionId}</span>
				<a
					className="inline-flex items-center gap-1 underline-offset-4 transition hover:text-foreground hover:underline"
					href={metadata.sourceUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					Civitai
					<ExternalLink className="size-2.5" />
				</a>
			</div>
			{metadata.triggerWords.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{metadata.triggerWords.slice(0, 8).map((word) => (
						<span
							className="rounded border border-foreground/10 px-1.5 py-0.5 text-[10px]"
							key={word}
						>
							{word}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}

function CivitaiLoraPreview({ metadata }: { metadata: CivitaiLoraMetadata }) {
	const compatible = isLtx23Compatible(metadata.baseModel);
	return (
		<div className="grid gap-2 rounded-lg bg-foreground/[0.04] p-2.5">
			<div className="flex min-w-0 items-start justify-between gap-2">
				<div className="grid min-w-0 gap-0.5">
					<p className="truncate font-medium text-[11px]">{metadata.name}</p>
					<p className="truncate text-[10px] text-muted-foreground">
						{metadata.versionName}
					</p>
				</div>
				<CompatibilityPill
					compatible={compatible}
					supportsGeneration={metadata.supportsGeneration}
				/>
			</div>
			<div className="flex min-w-0 flex-wrap items-center gap-1">
				<CivitaiPill>
					<code className="min-w-0 truncate">{metadata.air}</code>
				</CivitaiPill>
				<CivitaiPill>{metadata.baseModel || "unknown base"}</CivitaiPill>
			</div>
			{metadata.triggerWords.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{metadata.triggerWords.slice(0, 8).map((word) => (
						<span
							className="rounded border border-foreground/10 px-1.5 py-0.5 text-[10px]"
							key={word}
						>
							{word}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}

function CivitaiLoraSelector({
	form,
	onParamChange,
}: {
	form: ScenarioFormState;
	onParamChange: (key: string, value: string) => void;
}) {
	const activeMetadata = getActiveMetadata(form);
	const [sourceUrl, setSourceUrl] = useState(activeMetadata.sourceUrl);
	const [preview, setPreview] = useState<LoraSourcePreview | null>(null);
	const [selectedVersionId, setSelectedVersionId] = useState<number | null>(
		activeMetadata.versionId
	);
	const [isPreviewing, setIsPreviewing] = useState(false);
	const trimmedSourceUrl = sourceUrl.trim();
	const previewMetadata = preview
		? buildMetadataFromPreview({
				preview,
				sourceUrl: trimmedSourceUrl,
				versionId: selectedVersionId,
			})
		: null;
	const previewCompatible = previewMetadata
		? isLtx23Compatible(previewMetadata.baseModel)
		: false;
	const canUsePreview = Boolean(
		previewMetadata &&
			previewCompatible &&
			previewMetadata.supportsGeneration !== false
	);

	async function handlePreview() {
		if (!trimmedSourceUrl) {
			toast.error("Paste a Civitai LoRA URL first.");
			return;
		}
		setIsPreviewing(true);
		try {
			const result = await previewStudioLoraSource({
				sourceUrl: trimmedSourceUrl,
				sourceVersionId: selectedVersionId ?? undefined,
			});
			setPreview(result);
			setSelectedVersionId(
				result.sourceVersionId ?? result.variants?.[0]?.versionId ?? null
			);
			toast.success("Civitai LoRA loaded.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to load Civitai LoRA."
			);
		} finally {
			setIsPreviewing(false);
		}
	}

	function handleApplyPreview() {
		if (!previewMetadata) {
			return;
		}
		if (!canUsePreview) {
			toast.error("This LoRA is not available for LTXV 2.3 Civitai inference.");
			return;
		}
		applyLoraMetadata(previewMetadata, onParamChange);
		toast.success("Civitai LoRA selected.");
	}

	function handleResetDefault() {
		applyLoraMetadata(
			{
				air: CIVITAI_LTX23_DEFAULT_LORA.air,
				baseModel: CIVITAI_LTX23_DEFAULT_LORA.baseModel,
				modelId: Number(CIVITAI_LTX23_DEFAULT_LORA.modelId),
				name: CIVITAI_LTX23_DEFAULT_LORA.name,
				sourceUrl: CIVITAI_LTX23_DEFAULT_LORA.sourceUrl,
				supportsGeneration:
					CIVITAI_LTX23_DEFAULT_LORA.supportsGeneration === "true",
				triggerWords: [],
				versionId: Number(CIVITAI_LTX23_DEFAULT_LORA.versionId),
				versionName: "v1.0",
			},
			onParamChange
		);
		setSourceUrl(CIVITAI_LTX23_DEFAULT_LORA.sourceUrl);
		setPreview(null);
		setSelectedVersionId(Number(CIVITAI_LTX23_DEFAULT_LORA.versionId));
	}

	return (
		<section className="grid gap-2">
			<div className="flex min-w-0 items-center justify-between gap-2">
				<SectionLabel>Civitai LoRA</SectionLabel>
				<Button
					className="h-7 px-2 text-[10px]"
					onClick={handleResetDefault}
					size="sm"
					type="button"
					variant="ghost"
				>
					<RefreshCcw className="size-3" />
					Synth
				</Button>
			</div>

			<CivitaiLoraCard metadata={activeMetadata} />

			<div className="flex min-w-0 gap-1.5">
				<Input
					aria-label="Civitai LoRA URL"
					className="h-8 min-w-0 text-[11px]"
					onChange={(event) => {
						setSourceUrl(event.target.value);
						setPreview(null);
						setSelectedVersionId(null);
					}}
					placeholder="https://civitai.com/models/...?...modelVersionId=..."
					value={sourceUrl}
				/>
				<Button
					className="h-8 px-2 text-[11px]"
					disabled={isPreviewing}
					onClick={() => {
						handlePreview().catch(() => undefined);
					}}
					size="sm"
					type="button"
					variant="outline"
				>
					{isPreviewing ? (
						<Loader2 className="size-3 animate-spin" />
					) : (
						<Eye className="size-3" />
					)}
					Preview
				</Button>
			</div>

			{preview?.variants && preview.variants.length > 1 ? (
				<select
					aria-label="Civitai LoRA version"
					className="h-8 rounded-md border border-foreground/10 bg-background px-2 text-[11px] outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
					onChange={(event) => setSelectedVersionId(Number(event.target.value))}
					value={selectedVersionId ?? ""}
				>
					{preview.variants.map((variant) => (
						<option key={variant.versionId} value={variant.versionId}>
							{[variant.versionName, variant.baseModel, variant.fileName]
								.filter(Boolean)
								.join(" / ")}
						</option>
					))}
				</select>
			) : null}

			{previewMetadata ? (
				<CivitaiLoraPreview metadata={previewMetadata} />
			) : null}

			{previewMetadata ? (
				<Button
					className="w-full"
					disabled={!canUsePreview}
					onClick={handleApplyPreview}
					size="sm"
					type="button"
				>
					<CheckCircle2 className="size-3.5" />
					Use this Civitai LoRA
				</Button>
			) : null}
		</section>
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
		<div className="grid min-w-0 gap-4">
			<div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
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
				<div className="grid min-w-0 content-start gap-1.5">
					<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
						Engine
					</span>
					<div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg bg-foreground/[0.035] px-2.5 py-2">
						<CivitaiPill>LTX 2.3 · 22B dev</CivitaiPill>
						<CivitaiPill>{mode.toUpperCase()}</CivitaiPill>
						{selectedWorkflow.requiresInputImage ? (
							<span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground">
								<BadgeInfo className="size-2.5 shrink-0" />
								<span className="truncate">First frame from launch input</span>
							</span>
						) : null}
					</div>
				</div>
			</div>

			<CivitaiLoraSelector form={form} onParamChange={onParamChange} />

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
				<SegmentedParameterField
					onParamChange={onParamChange}
					parameter={duration}
					value={getParamValue(form, duration)}
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
		</div>
	);
}
