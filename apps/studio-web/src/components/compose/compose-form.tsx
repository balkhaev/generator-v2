"use client";

import type { LoraRegistryEntry } from "@generator/contracts/loras";
import type {
	StudioPromptEnhanceMode,
	StudioPromptSource,
} from "@generator/contracts/studio";
import { enhanceStudioPrompt } from "@generator/studio-client/client";
import {
	createScenarioFormState,
	type ScenarioFormState,
	type WorkflowDefinition,
	type WorkflowParameter,
} from "@generator/studio-client/shared";
import { Button } from "@generator/ui/components/button";
import { EnhancePromptButton } from "@generator/ui/components/enhance-prompt-button";
import { InfoTooltip } from "@generator/ui/components/info-tooltip";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { SectionLabel } from "@generator/ui/components/section-label";
import { cn } from "@generator/ui/lib/utils";
import {
	AlertCircle,
	ChevronDown,
	Clapperboard,
	Cpu,
	Loader2,
	Plus,
	Wand2,
} from "lucide-react";
import {
	type Dispatch,
	type FormEvent,
	type ReactNode,
	type SetStateAction,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";

import { buildFinalPromptPreview } from "@/components/final-prompt-preview";

import CivitaiLtx23Setup, {
	createCivitaiLtx23FormState,
	isCivitaiLtx23Workflow,
} from "./civitai-ltx23-form";
import LoraStack from "./lora-stack";
import ParameterField from "./parameter-field";
import {
	isRunpodWan22PussyWorkflow,
	RunpodWan22PussyFields,
} from "./runpod-wan22-pussy-form";
import WorkflowGrid from "./workflow-grid";
import {
	type Approach,
	classifyWorkflow,
	filterWorkflows,
	getAvailableApproaches,
	getAvailableModalities,
	getLoraSlots,
	type LoraSlotDefinition,
	type Modality,
	pickDefaultWorkflow,
} from "./workflow-matrix";

const PROMPT_LIMIT = 1500;

type ProviderTab = "inference" | "civitai";

const promptCleanupPattern = /[^\p{L}\p{N}\s]/gu;
const promptSplitPattern = /\s+/u;
const loraUrlSuffixPattern = /Url$/i;
const portraitOutputDefaults: Record<string, string> = {
	aspectRatio: "9:16",
	imageSize: "portrait_16_9",
	videoSize: "portrait_16_9",
};

const promptStopWords = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"in",
	"into",
	"is",
	"it",
	"of",
	"on",
	"or",
	"the",
	"to",
	"with",
]);

function getPortraitOutputDefault(
	parameter: WorkflowParameter,
	workflow: WorkflowDefinition
) {
	const defaultValue = portraitOutputDefaults[parameter.key];
	if (!(defaultValue && parameter.enumValues?.includes(defaultValue))) {
		return null;
	}
	if (workflow.requiresInputImage && parameter.enumValues.includes("auto")) {
		return null;
	}
	return defaultValue;
}

export function createComposeScenarioFormState(
	workflow: WorkflowDefinition
): ScenarioFormState {
	if (isCivitaiLtx23Workflow(workflow)) {
		return createCivitaiLtx23FormState(workflow);
	}
	const form = createScenarioFormState(workflow);
	const params = { ...form.params };
	for (const parameter of workflow.parameters) {
		const defaultValue = getPortraitOutputDefault(parameter, workflow);
		if (defaultValue) {
			params[parameter.key] = defaultValue;
		}
	}
	return { ...form, params };
}

// Reference image for prompt enhance (image-to-* workflows only): optional
// `image-url` params (e.g. `endImageUrl`). Text-to-image / text-to-video
// scenarios never send these to the enhance API — see `textSourceOnly` on
// `ScenarioEnhancePromptButton`.
function useReferenceImageUrl(
	workflow: WorkflowDefinition | null,
	form: ScenarioFormState
): string | null {
	return useMemo(() => {
		if (!workflow) {
			return null;
		}
		for (const parameter of workflow.parameters) {
			if (parameter.kind !== "image-url") {
				continue;
			}
			const raw = form.params[parameter.key];
			if (typeof raw !== "string") {
				continue;
			}
			const trimmed = raw.trim();
			if (trimmed.length > 0) {
				return trimmed;
			}
		}
		return null;
	}, [form.params, workflow]);
}

function ScenarioEnhancePromptButton({
	onEnhanced,
	prompt,
	referenceImageUrl,
	textSourceOnly,
}: {
	onEnhanced: (promptSource: StudioPromptSource) => void;
	prompt: string;
	referenceImageUrl: string | null;
	/** Text-to-image / text-to-video: enhance prompt as plain text only (ignore optional image URLs in params). */
	textSourceOnly: boolean;
}) {
	const visionImageUrl = textSourceOnly ? null : referenceImageUrl;
	const useVisionEnhance = Boolean(visionImageUrl);
	const promptSourceRef = useRef<{
		mode: StudioPromptEnhanceMode;
		originalPrompt: string;
	} | null>(null);
	return (
		<EnhancePromptButton
			enhance={async (value) => {
				const result = await enhanceStudioPrompt(value, {
					imageUrl: visionImageUrl,
				});
				promptSourceRef.current = {
					mode: result.mode,
					originalPrompt: value,
				};
				if (result.notice) {
					toast.warning(result.notice);
				}
				return result.enhanced;
			}}
			label={useVisionEnhance ? "Enhance for image" : "Enhance"}
			onEnhanced={(enhanced) => {
				const source = promptSourceRef.current;
				onEnhanced({
					enhancedPrompt: enhanced,
					mode: source?.mode ?? (useVisionEnhance ? "vision" : "text"),
					originalPrompt: source?.originalPrompt ?? prompt.trim(),
				});
				toast.success(
					useVisionEnhance
						? "Prompt rewritten for the reference image"
						: "Prompt enhanced"
				);
			}}
			onError={(message) => toast.error(message)}
			prompt={prompt}
			tooltip={
				useVisionEnhance
					? "Rewrite this prompt as an action grounded in the reference image (vision)"
					: "Rewrite this prompt with the configured AI provider"
			}
		/>
	);
}

function suggestNameFromPrompt(prompt: string) {
	const words = prompt
		.replace(promptCleanupPattern, " ")
		.split(promptSplitPattern)
		.filter(
			(token) => token.length > 1 && !promptStopWords.has(token.toLowerCase())
		)
		.slice(0, 5);

	if (words.length === 0) {
		return "";
	}

	return words
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}

interface PartitionedParameters {
	advanced: WorkflowParameter[];
	output: WorkflowParameter[];
	sampling: WorkflowParameter[];
}

function partitionNonLoraParameters(
	workflow: WorkflowDefinition,
	options: { hideAspectRatio?: boolean } = {}
): PartitionedParameters {
	const handledKeys = new Set<string>();
	for (const parameter of workflow.parameters) {
		if (parameter.kind === "lora-url") {
			handledKeys.add(parameter.key);
			const base = parameter.key.replace(loraUrlSuffixPattern, "");
			const weightParameter = workflow.parameters.find(
				(other) => other.key === `${base}Weight` || other.key === `${base}Scale`
			);
			if (weightParameter) {
				handledKeys.add(weightParameter.key);
			}
		}
	}

	const output: WorkflowParameter[] = [];
	const sampling: WorkflowParameter[] = [];
	const advanced: WorkflowParameter[] = [];

	for (const parameter of workflow.parameters) {
		if (handledKeys.has(parameter.key)) {
			continue;
		}

		if (
			parameter.key === "numInferenceSteps" ||
			parameter.key === "seed" ||
			parameter.key === "enableSafetyChecker" ||
			parameter.key === "enableOutputSafetyChecker" ||
			parameter.key === "enablePromptExpansion"
		) {
			continue;
		}

		if (options.hideAspectRatio && parameter.key === "aspectRatio") {
			continue;
		}

		if (
			parameter.key === "aspectRatio" ||
			parameter.key === "duration" ||
			parameter.key === "endImageUrl" ||
			parameter.key === "fps" ||
			parameter.key === "framesPerSecond" ||
			parameter.key === "imageSize" ||
			parameter.key === "numFrames" ||
			parameter.key === "numImages" ||
			parameter.key === "outputFormat" ||
			parameter.key === "resolution"
		) {
			output.push(parameter);
			continue;
		}

		sampling.push(parameter);
	}

	return { advanced, output, sampling };
}

function validateCivitaiLtx23(form: ScenarioFormState): string[] {
	const errors: string[] = [];
	const loraAir = form.params.loraAir?.trim() ?? "";
	const loraBaseModel = form.params.loraBaseModel?.trim() ?? "";
	if (!loraAir) {
		errors.push("Civitai LoRA AIR is required");
	}
	if (loraBaseModel && loraBaseModel !== "ltx-2-3") {
		errors.push("Civitai LoRA must be compatible with LTXV 2.3");
	}
	if (form.params.loraSupportsGeneration === "false") {
		errors.push("Civitai LoRA must support Civitai generation");
	}
	return errors;
}

function validate(
	form: ScenarioFormState,
	workflow: WorkflowDefinition
): string[] {
	const errors: string[] = [];

	if (!form.name.trim()) {
		errors.push("Name is required");
	}

	if (!form.prompt.trim()) {
		errors.push("Prompt is required");
	}

	for (const parameter of workflow.parameters) {
		if (parameter.optional) {
			continue;
		}

		const value = form.params[parameter.key]?.trim() ?? "";

		if (value === "") {
			if (parameter.kind === "lora-url") {
				errors.push("At least one LoRA is required");
			} else if (parameter.type === "number" && parameter.defaultValue === "") {
				errors.push(`${parameter.label} is required`);
			}
		}
	}

	if (isCivitaiLtx23Workflow(workflow)) {
		errors.push(...validateCivitaiLtx23(form));
	}

	return errors;
}

interface LoraSectionProps {
	adminLorasHref: string;
	availableLoras: LoraRegistryEntry[];
	form: ScenarioFormState;
	isOptional: boolean;
	loraSlots: LoraSlotDefinition[];
	lorasError: string | null;
	onLorasImported?: (entries: LoraRegistryEntry[]) => void;
	onParamChange: (key: string, value: string) => void;
	selectedWorkflow: WorkflowDefinition;
}

function LoraSection({
	adminLorasHref,
	availableLoras,
	form,
	isOptional,
	loraSlots,
	lorasError,
	onLorasImported,
	onParamChange,
	selectedWorkflow,
}: LoraSectionProps) {
	const baseModelLabel = selectedWorkflow.baseModel ?? "any";
	return (
		<section className="grid gap-2">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-baseline gap-1.5">
					<SectionLabel>Style LoRAs</SectionLabel>
					{isOptional ? (
						<span className="text-[10px] text-muted-foreground/70">
							optional · skip to use the base model
						</span>
					) : null}
				</div>
				<span className="text-[10px] text-muted-foreground">
					{availableLoras.length} for{" "}
					<code className="rounded bg-foreground/[0.06] px-1">
						{baseModelLabel}
					</code>
				</span>
			</div>
			{lorasError ? (
				<div className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300">
					<AlertCircle className="mt-0.5 size-3 shrink-0" />
					<span>
						Couldn't load LoRAs for <code>{baseModelLabel}</code>: {lorasError}
					</span>
				</div>
			) : null}
			<LoraStack
				adminHref={adminLorasHref}
				availableLoras={availableLoras}
				form={form}
				onLorasImported={onLorasImported}
				onParamChange={onParamChange}
				slots={loraSlots}
				workflow={selectedWorkflow}
			/>
		</section>
	);
}

function getCharCounterTone(length: number, isOver: boolean) {
	if (isOver) {
		return "text-rose-600 dark:text-rose-400";
	}
	if (length > PROMPT_LIMIT * 0.9) {
		return "text-amber-600 dark:text-amber-400";
	}
	return "text-muted-foreground";
}

function resolveApproach(
	workflows: WorkflowDefinition[],
	preferred: Approach,
	modality: Modality
): Approach {
	const approaches = getAvailableApproaches(workflows, modality);
	if (approaches.includes(preferred)) {
		return preferred;
	}
	return approaches[0] ?? preferred;
}

interface ParametersGroupProps {
	form: ScenarioFormState;
	onParamChange: (key: string, value: string) => void;
	parameters: WorkflowParameter[];
}

function ParametersGroup({
	form,
	onParamChange,
	parameters,
}: ParametersGroupProps) {
	return (
		<div className="grid gap-3">
			{parameters.map((parameter) => (
				<ParameterField
					key={parameter.key}
					onChange={(value) => onParamChange(parameter.key, value)}
					parameter={parameter}
					value={form.params[parameter.key] ?? parameter.defaultValue}
				/>
			))}
		</div>
	);
}

interface AdvancedSectionProps {
	form: ScenarioFormState;
	onParamChange: (key: string, value: string) => void;
	parameters: WorkflowParameter[];
}

function AdvancedSection({
	form,
	onParamChange,
	parameters,
}: AdvancedSectionProps) {
	const [open, setOpen] = useState(false);
	return (
		<section className="grid gap-2">
			<button
				aria-expanded={open}
				className="flex w-full items-center justify-between rounded-lg bg-foreground/[0.03] px-3 py-2 text-left transition hover:bg-foreground/[0.06]"
				onClick={() => setOpen((current) => !current)}
				type="button"
			>
				<SectionLabel>Advanced</SectionLabel>
				<ChevronDown
					className={cn(
						"size-3.5 text-muted-foreground transition-transform",
						open && "rotate-180"
					)}
				/>
			</button>
			{open ? (
				<div className="px-1">
					<ParametersGroup
						form={form}
						onParamChange={onParamChange}
						parameters={parameters}
					/>
				</div>
			) : null}
		</section>
	);
}

interface FooterBarProps {
	errors: string[];
	isReady: boolean;
	isSubmitting: boolean;
	workflowName: string;
}

function FooterBar({
	errors,
	isReady,
	isSubmitting,
	workflowName,
}: FooterBarProps) {
	return (
		<div className="mt-2 border-foreground/8 border-t bg-background/95 pt-3">
			{errors.length > 0 ? (
				<div className="mb-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
					<AlertCircle className="mt-0.5 size-3 shrink-0" />
					<span>{errors.join(" · ")}</span>
				</div>
			) : null}
			<div className="flex items-center justify-between gap-2">
				<p className="truncate text-[11px] text-muted-foreground">
					{workflowName}
				</p>
				<Button disabled={!isReady || isSubmitting} size="sm" type="submit">
					{isSubmitting ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Plus className="size-3.5" />
					)}
					Save scenario
				</Button>
			</div>
		</div>
	);
}

interface WorkflowSetupSectionProps {
	availableApproaches: Approach[];
	availableModalities: Modality[];
	filteredWorkflows: WorkflowDefinition[];
	form: ScenarioFormState;
	isCivitaiLtx23: boolean;
	onApproachChange: (approach: Approach) => void;
	onModalityChange: (modality: Modality) => void;
	onParamChange: (key: string, value: string) => void;
	onWorkflowChange: (workflowKey: string) => void;
	selectedClassification: NonNullable<ReturnType<typeof classifyWorkflow>>;
	selectedWorkflow: WorkflowDefinition;
	workflows: WorkflowDefinition[];
}

function WorkflowSetupSection({
	availableApproaches,
	availableModalities,
	filteredWorkflows,
	form,
	isCivitaiLtx23,
	onApproachChange,
	onModalityChange,
	onParamChange,
	onWorkflowChange,
	selectedClassification,
	selectedWorkflow,
	workflows,
}: WorkflowSetupSectionProps) {
	if (isCivitaiLtx23) {
		return (
			<CivitaiLtx23Setup
				form={form}
				onParamChange={onParamChange}
				onWorkflowChange={onWorkflowChange}
				selectedWorkflow={selectedWorkflow}
				workflows={workflows}
			/>
		);
	}

	return (
		<section className="grid gap-2">
			<SectionLabel>Workflow</SectionLabel>
			<WorkflowGrid
				approach={selectedClassification.approach}
				availableApproaches={availableApproaches}
				availableModalities={availableModalities}
				filteredWorkflows={filteredWorkflows}
				modality={selectedClassification.modality}
				onApproachChange={onApproachChange}
				onModalityChange={onModalityChange}
				onWorkflowChange={onWorkflowChange}
				selectedWorkflowKey={selectedWorkflow.key}
			/>
		</section>
	);
}

interface DefaultParameterSectionsProps {
	form: ScenarioFormState;
	isImageToVideo: boolean;
	onParamChange: (key: string, value: string) => void;
	partitioned: PartitionedParameters;
}

function DefaultParameterSections({
	form,
	isImageToVideo,
	onParamChange,
	partitioned,
}: DefaultParameterSectionsProps) {
	return (
		<>
			{partitioned.output.length > 0 ? (
				<section className="grid gap-2">
					<SectionLabel>Output</SectionLabel>
					{isImageToVideo ? (
						<p className="rounded-lg bg-foreground/[0.03] px-3 py-2 text-[11px] text-muted-foreground">
							Output keeps the source image proportions automatically.
						</p>
					) : null}
					<ParametersGroup
						form={form}
						onParamChange={onParamChange}
						parameters={partitioned.output}
					/>
				</section>
			) : null}

			{partitioned.sampling.length > 0 ? (
				<section className="grid gap-2">
					<SectionLabel>Sampling</SectionLabel>
					<ParametersGroup
						form={form}
						onParamChange={onParamChange}
						parameters={partitioned.sampling}
					/>
				</section>
			) : null}

			{partitioned.advanced.length > 0 ? (
				<AdvancedSection
					form={form}
					onParamChange={onParamChange}
					parameters={partitioned.advanced}
				/>
			) : null}
		</>
	);
}

function ComposeTabs({
	civitaiDisabled = false,
	onChange,
	value,
}: {
	civitaiDisabled?: boolean;
	onChange: (next: ProviderTab) => void;
	value: ProviderTab;
}) {
	const tabs: { disabled?: boolean; id: ProviderTab; label: string }[] = [
		{ id: "inference", label: "Inference" },
		{ disabled: civitaiDisabled, id: "civitai", label: "Civitai" },
	];
	return (
		<div
			aria-label="Scenario inference provider"
			className="grid grid-cols-2 gap-1 rounded-lg bg-foreground/[0.04] p-1"
			role="tablist"
		>
			{tabs.map((tab) => {
				const active = value === tab.id;
				return (
					<button
						aria-selected={active}
						className={cn(
							"h-8 rounded-md px-3 font-medium text-[11px] transition",
							active
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:bg-background/60 hover:text-foreground",
							tab.disabled && "cursor-not-allowed opacity-45"
						)}
						disabled={tab.disabled}
						key={tab.id}
						onClick={() => onChange(tab.id)}
						role="tab"
						type="button"
					>
						{tab.label}
					</button>
				);
			})}
		</div>
	);
}

function ProviderPanel({
	children,
	civitaiDisabled,
	onProviderChange,
	selectedClassification,
	selectedWorkflow,
	value,
}: {
	children: ReactNode;
	civitaiDisabled: boolean;
	onProviderChange: (next: ProviderTab) => void;
	selectedClassification: NonNullable<ReturnType<typeof classifyWorkflow>>;
	selectedWorkflow: WorkflowDefinition;
	value: ProviderTab;
}) {
	const isCivitai = value === "civitai";
	const sourceLabel =
		selectedClassification.approach === "image"
			? "Image source"
			: "Text source";
	const outputLabel =
		selectedClassification.modality === "video" ? "Video" : "Image";
	return (
		<section className="overflow-hidden rounded-xl border border-foreground/10 bg-background/80 shadow-sm">
			<div className="border-foreground/8 border-b bg-foreground/[0.02] p-2">
				<ComposeTabs
					civitaiDisabled={civitaiDisabled}
					onChange={onProviderChange}
					value={value}
				/>
			</div>
			<div className="flex min-w-0 flex-col gap-2 border-foreground/8 border-b px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-center gap-2">
					<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-muted-foreground">
						{isCivitai ? (
							<Clapperboard className="size-4" />
						) : (
							<Cpu className="size-4" />
						)}
					</span>
					<div className="grid min-w-0 gap-0.5">
						<p className="font-medium text-[12px]">
							{isCivitai ? "Civitai LTX 2.3" : "Inference workflow"}
						</p>
						<p className="truncate text-[11px] text-muted-foreground">
							{selectedWorkflow.name}
						</p>
					</div>
				</div>
				<div className="flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
					<span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5">
						{sourceLabel}
					</span>
					<span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5">
						{outputLabel}
					</span>
					{selectedWorkflow.baseModel ? (
						<span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5">
							{selectedWorkflow.baseModel}
						</span>
					) : null}
				</div>
			</div>
			<div className="grid gap-4 p-3">{children}</div>
		</section>
	);
}

interface ScenarioSectionProps {
	finalPromptPreview: string;
	form: ScenarioFormState;
	isOverLimit: boolean;
	onFormChange: Dispatch<SetStateAction<ScenarioFormState | null>>;
	promptLength: number;
	referenceImageUrl: string | null;
	selectedWorkflow: WorkflowDefinition;
	suggestedName: string;
}

function ScenarioSection({
	finalPromptPreview,
	form,
	isOverLimit,
	onFormChange,
	promptLength,
	referenceImageUrl,
	selectedWorkflow,
	suggestedName,
}: ScenarioSectionProps) {
	const nameId = useId();
	const promptId = useId();
	return (
		<section className="grid gap-3 rounded-xl border border-foreground/10 bg-background/80 p-3 shadow-sm">
			<div className="flex items-center justify-between gap-2">
				<SectionLabel>Scenario</SectionLabel>
				<span
					className={cn(
						"text-[10px] tabular-nums",
						getCharCounterTone(promptLength, isOverLimit)
					)}
				>
					{promptLength}/{PROMPT_LIMIT}
				</span>
			</div>
			<div className="grid gap-1.5">
				<div className="flex items-baseline justify-between gap-2">
					<Label className="font-medium text-[11px]" htmlFor={nameId}>
						Name
					</Label>
					{suggestedName && suggestedName !== form.name ? (
						<button
							className="inline-flex items-center gap-1 text-[10px] text-muted-foreground underline transition hover:text-foreground"
							onClick={() => onFormChange({ ...form, name: suggestedName })}
							type="button"
						>
							<Wand2 className="size-3" />
							Use "{suggestedName}"
						</button>
					) : null}
				</div>
				<Input
					id={nameId}
					onChange={(event) =>
						onFormChange({ ...form, name: event.target.value })
					}
					placeholder="Cinematic close-up"
					value={form.name}
				/>
			</div>

			<div className="grid gap-1.5">
				<div className="flex items-baseline justify-between gap-2">
					<div className="flex items-center gap-1.5">
						<Label className="font-medium text-[11px]" htmlFor={promptId}>
							Prompt
						</Label>
						<InfoTooltip
							align="start"
							contentClassName="max-w-[min(34rem,calc(100vw-2rem))] flex-col items-start gap-1.5"
							label="Show final prompt"
							side="top"
						>
							<span className="font-medium">Final prompt</span>
							<span className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4">
								{finalPromptPreview}
							</span>
						</InfoTooltip>
					</div>
					<div className="flex items-center gap-2">
						<ScenarioEnhancePromptButton
							onEnhanced={(promptSource) =>
								onFormChange({
									...form,
									prompt: promptSource.enhancedPrompt,
									promptSource,
								})
							}
							prompt={form.prompt}
							referenceImageUrl={referenceImageUrl}
							textSourceOnly={!selectedWorkflow.requiresInputImage}
						/>
					</div>
				</div>
				<textarea
					className={cn(
						"min-h-28 w-full resize-y rounded-lg border bg-background/45 px-2.5 py-2 text-xs leading-5 outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50",
						isOverLimit ? "border-rose-500/60" : "border-input"
					)}
					id={promptId}
					onChange={(event) =>
						onFormChange({
							...form,
							prompt: event.target.value,
							promptSource: null,
						})
					}
					placeholder={selectedWorkflow.promptHint}
					value={form.prompt}
				/>
			</div>
		</section>
	);
}

interface SettingsSectionProps extends WorkflowSetupSectionProps {
	adminLorasHref: string;
	availableLoras: LoraRegistryEntry[];
	isImageToVideo: boolean;
	loraSlots: LoraSlotDefinition[];
	lorasError: string | null;
	onLorasImported?: (entries: LoraRegistryEntry[]) => void;
	partitioned: PartitionedParameters;
	showLoraSection: boolean;
}

function SettingsSection({
	adminLorasHref,
	availableApproaches,
	availableLoras,
	availableModalities,
	filteredWorkflows,
	form,
	isCivitaiLtx23,
	isImageToVideo,
	loraSlots,
	lorasError,
	onApproachChange,
	onLorasImported,
	onModalityChange,
	onParamChange,
	onWorkflowChange,
	partitioned,
	selectedClassification,
	selectedWorkflow,
	showLoraSection,
	workflows,
}: SettingsSectionProps) {
	let parameterSection: ReactNode = null;
	if (!isCivitaiLtx23) {
		if (isRunpodWan22PussyWorkflow(selectedWorkflow)) {
			parameterSection = (
				<RunpodWan22PussyFields
					form={form}
					onParamChange={onParamChange}
					workflow={selectedWorkflow}
				/>
			);
		} else {
			parameterSection = (
				<DefaultParameterSections
					form={form}
					isImageToVideo={isImageToVideo}
					onParamChange={onParamChange}
					partitioned={partitioned}
				/>
			);
		}
	}

	return (
		<>
			<WorkflowSetupSection
				availableApproaches={availableApproaches}
				availableModalities={availableModalities}
				filteredWorkflows={filteredWorkflows}
				form={form}
				isCivitaiLtx23={isCivitaiLtx23}
				onApproachChange={onApproachChange}
				onModalityChange={onModalityChange}
				onParamChange={onParamChange}
				onWorkflowChange={onWorkflowChange}
				selectedClassification={selectedClassification}
				selectedWorkflow={selectedWorkflow}
				workflows={workflows}
			/>

			{showLoraSection ? (
				<LoraSection
					adminLorasHref={adminLorasHref}
					availableLoras={availableLoras}
					form={form}
					isOptional={!selectedClassification.requiresLora}
					loraSlots={loraSlots}
					lorasError={lorasError}
					onLorasImported={onLorasImported}
					onParamChange={onParamChange}
					selectedWorkflow={selectedWorkflow}
				/>
			) : null}

			{parameterSection}
		</>
	);
}

interface ComposeFormProps {
	adminLorasHref: string;
	availableLoras: LoraRegistryEntry[];
	form: ScenarioFormState;
	formId?: string;
	hideFooter?: boolean;
	isSubmitting: boolean;
	lorasError?: string | null;
	onFormChange: Dispatch<SetStateAction<ScenarioFormState | null>>;
	onLorasImported?: (entries: LoraRegistryEntry[]) => void;
	onSubmit: () => Promise<void> | void;
	onValidityChange?: (input: { isReady: boolean; errors: string[] }) => void;
	workflows: WorkflowDefinition[];
}

export default function ComposeForm({
	adminLorasHref,
	availableLoras,
	form,
	formId,
	hideFooter = false,
	isSubmitting,
	lorasError = null,
	onFormChange,
	onLorasImported,
	onSubmit,
	onValidityChange,
	workflows,
}: ComposeFormProps) {
	const selectedWorkflow =
		workflows.find((workflow) => workflow.key === form.workflowKey) ?? null;
	const isCivitaiLtx23 = selectedWorkflow
		? isCivitaiLtx23Workflow(selectedWorkflow)
		: false;
	const providerTab: ProviderTab = isCivitaiLtx23 ? "civitai" : "inference";
	const inferenceWorkflows = useMemo(
		() => workflows.filter((workflow) => !isCivitaiLtx23Workflow(workflow)),
		[workflows]
	);
	const civitaiWorkflows = useMemo(
		() => workflows.filter(isCivitaiLtx23Workflow),
		[workflows]
	);
	const workflowPool =
		providerTab === "civitai" ? civitaiWorkflows : inferenceWorkflows;
	const selectedClassification = selectedWorkflow
		? classifyWorkflow(selectedWorkflow)
		: null;

	const availableModalities = useMemo(
		() => getAvailableModalities(workflowPool),
		[workflowPool]
	);

	const availableApproaches = useMemo(
		() =>
			selectedClassification
				? getAvailableApproaches(workflowPool, selectedClassification.modality)
				: [],
		[workflowPool, selectedClassification]
	);

	const filteredWorkflows = useMemo(() => {
		if (!selectedClassification) {
			return [] as WorkflowDefinition[];
		}
		return filterWorkflows(workflowPool, {
			approach: selectedClassification.approach,
			modality: selectedClassification.modality,
		});
	}, [workflowPool, selectedClassification]);

	const loraSlots = selectedWorkflow ? getLoraSlots(selectedWorkflow) : [];
	const isRunpodWan22Pussy = selectedWorkflow
		? isRunpodWan22PussyWorkflow(selectedWorkflow)
		: false;
	const showLoraSection = Boolean(
		!(isCivitaiLtx23 || isRunpodWan22Pussy) &&
			selectedClassification?.hasLora &&
			loraSlots.length > 0
	);

	const isImageToVideo = Boolean(
		selectedClassification &&
			selectedClassification.modality === "video" &&
			selectedClassification.approach === "image"
	);

	const referenceImageUrl = useReferenceImageUrl(selectedWorkflow, form);

	const partitioned = useMemo(() => {
		if (!selectedWorkflow) {
			return {
				advanced: [] as WorkflowParameter[],
				output: [] as WorkflowParameter[],
				sampling: [] as WorkflowParameter[],
			};
		}
		return partitionNonLoraParameters(selectedWorkflow, {
			hideAspectRatio: isImageToVideo,
		});
	}, [selectedWorkflow, isImageToVideo]);

	const errors = useMemo(() => {
		if (!selectedWorkflow) {
			return ["Select a workflow"];
		}
		return validate(form, selectedWorkflow);
	}, [form, selectedWorkflow]);

	const promptLength = form.prompt.length;
	const isOverLimit = promptLength > PROMPT_LIMIT;
	const isReady = errors.length === 0 && !isOverLimit;
	const finalPrompt = useMemo(() => {
		if (!selectedWorkflow) {
			return form.prompt;
		}
		return buildFinalPromptPreview({
			availableLoras,
			params: form.params,
			prompt: form.prompt,
			workflow: selectedWorkflow,
		});
	}, [availableLoras, form, selectedWorkflow]);
	const finalPromptPreview = form.prompt.trim()
		? finalPrompt
		: "Prompt is empty.";
	const suggestedName = useMemo(
		() => suggestNameFromPrompt(form.prompt),
		[form.prompt]
	);

	useEffect(() => {
		onValidityChange?.({ errors, isReady });
	}, [errors, isReady, onValidityChange]);

	function applyWorkflow(nextWorkflow: WorkflowDefinition | null) {
		if (!nextWorkflow || nextWorkflow.key === form.workflowKey) {
			return;
		}
		if (isCivitaiLtx23Workflow(nextWorkflow)) {
			onFormChange(createCivitaiLtx23FormState(nextWorkflow, form));
			return;
		}
		const next = createComposeScenarioFormState(nextWorkflow);
		onFormChange({
			...next,
			name: form.name,
			prompt: form.prompt,
			promptSource: form.promptSource ?? null,
		});
	}

	function pickWorkflowForProvider(nextProvider: ProviderTab) {
		const pool =
			nextProvider === "civitai" ? civitaiWorkflows : inferenceWorkflows;
		if (pool.length === 0) {
			return null;
		}
		if (selectedClassification) {
			const sameShape = pickDefaultWorkflow(pool, {
				approach: selectedClassification.approach,
				modality: selectedClassification.modality,
			});
			if (sameShape) {
				return sameShape;
			}
		}
		return pool[0] ?? null;
	}

	function handleProviderTabChange(nextProvider: ProviderTab) {
		if (nextProvider === providerTab) {
			return;
		}
		applyWorkflow(pickWorkflowForProvider(nextProvider));
	}

	function handleModalityChange(nextModality: Modality) {
		if (
			!selectedClassification ||
			nextModality === selectedClassification.modality
		) {
			return;
		}
		const nextApproach = resolveApproach(
			workflowPool,
			selectedClassification.approach,
			nextModality
		);
		applyWorkflow(
			pickDefaultWorkflow(workflowPool, {
				approach: nextApproach,
				modality: nextModality,
			})
		);
	}

	function handleApproachChange(nextApproach: Approach) {
		if (
			!selectedClassification ||
			nextApproach === selectedClassification.approach
		) {
			return;
		}
		applyWorkflow(
			pickDefaultWorkflow(workflowPool, {
				approach: nextApproach,
				modality: selectedClassification.modality,
			})
		);
	}

	function handleWorkflowChange(nextWorkflowKey: string) {
		if (nextWorkflowKey === form.workflowKey) {
			return;
		}
		applyWorkflow(
			workflowPool.find((workflow) => workflow.key === nextWorkflowKey) ?? null
		);
	}

	function handleParamChange(key: string, value: string) {
		onFormChange((current) => {
			if (!current) {
				return current;
			}
			return {
				...current,
				params: { ...current.params, [key]: value },
			};
		});
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!isReady) {
			return;
		}
		const result = onSubmit();
		if (result instanceof Promise) {
			result.catch(() => undefined);
		}
	}

	if (!(selectedWorkflow && selectedClassification)) {
		return (
			<div className="rounded-lg bg-rose-500/10 px-3 py-2 text-rose-700 text-xs dark:text-rose-300">
				No workflows are available.
			</div>
		);
	}

	return (
		<form className="grid min-w-0 gap-5" id={formId} onSubmit={handleSubmit}>
			<ProviderPanel
				civitaiDisabled={civitaiWorkflows.length === 0}
				onProviderChange={handleProviderTabChange}
				selectedClassification={selectedClassification}
				selectedWorkflow={selectedWorkflow}
				value={providerTab}
			>
				{isCivitaiLtx23 ? (
					<WorkflowSetupSection
						availableApproaches={availableApproaches}
						availableModalities={availableModalities}
						filteredWorkflows={filteredWorkflows}
						form={form}
						isCivitaiLtx23={isCivitaiLtx23}
						onApproachChange={handleApproachChange}
						onModalityChange={handleModalityChange}
						onParamChange={handleParamChange}
						onWorkflowChange={handleWorkflowChange}
						selectedClassification={selectedClassification}
						selectedWorkflow={selectedWorkflow}
						workflows={civitaiWorkflows}
					/>
				) : (
					<SettingsSection
						adminLorasHref={adminLorasHref}
						availableApproaches={availableApproaches}
						availableLoras={availableLoras}
						availableModalities={availableModalities}
						filteredWorkflows={filteredWorkflows}
						form={form}
						isCivitaiLtx23={isCivitaiLtx23}
						isImageToVideo={isImageToVideo}
						loraSlots={loraSlots}
						lorasError={lorasError}
						onApproachChange={handleApproachChange}
						onLorasImported={onLorasImported}
						onModalityChange={handleModalityChange}
						onParamChange={handleParamChange}
						onWorkflowChange={handleWorkflowChange}
						partitioned={partitioned}
						selectedClassification={selectedClassification}
						selectedWorkflow={selectedWorkflow}
						showLoraSection={showLoraSection}
						workflows={inferenceWorkflows}
					/>
				)}
			</ProviderPanel>

			<ScenarioSection
				finalPromptPreview={finalPromptPreview}
				form={form}
				isOverLimit={isOverLimit}
				onFormChange={onFormChange}
				promptLength={promptLength}
				referenceImageUrl={referenceImageUrl}
				selectedWorkflow={selectedWorkflow}
				suggestedName={suggestedName}
			/>

			{hideFooter ? null : (
				<FooterBar
					errors={errors}
					isReady={isReady}
					isSubmitting={isSubmitting}
					workflowName={selectedWorkflow.name}
				/>
			)}
		</form>
	);
}
