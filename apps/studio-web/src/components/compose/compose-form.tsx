"use client";

import type { LoraRegistryEntry } from "@generator/contracts/loras";
import { enhanceStudioPrompt } from "@generator/studio-client/client";
import {
	createScenarioFormState,
	type ScenarioFormState,
	type WorkflowDefinition,
	type WorkflowParameter,
} from "@generator/studio-client/shared";
import { Button } from "@generator/ui/components/button";
import { EnhancePromptButton } from "@generator/ui/components/enhance-prompt-button";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { SectionLabel } from "@generator/ui/components/section-label";
import { cn } from "@generator/ui/lib/utils";
import {
	AlertCircle,
	ChevronDown,
	Loader2,
	Plus,
	Sparkles,
	Wand2,
} from "lucide-react";
import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import LoraStack from "./lora-stack";
import ParameterField from "./parameter-field";
import {
	type Approach,
	classifyWorkflow,
	describeWorkflowSelection,
	findCandidateWorkflows,
	findWorkflow,
	getAvailableApproaches,
	getAvailableBaseModels,
	getLoraSlots,
	type Modality,
	supportsLora,
	type WorkflowSelection,
} from "./workflow-matrix";
import WorkflowSelector from "./workflow-selector";

const PROMPT_LIMIT = 1500;

const promptCleanupPattern = /[^\p{L}\p{N}\s]/gu;
const promptSplitPattern = /\s+/u;
const loraUrlSuffixPattern = /Url$/i;

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
	workflow: WorkflowDefinition
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

	return errors;
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

function buildSelectionFromForm(
	workflow: WorkflowDefinition | null
): WorkflowSelection | null {
	if (!workflow) {
		return null;
	}
	return describeWorkflowSelection(workflow);
}

function getAvailableModalities(workflows: WorkflowDefinition[]): Modality[] {
	const seen = new Set<Modality>();
	for (const workflow of workflows) {
		seen.add(classifyWorkflow(workflow).modality);
	}
	return Array.from(seen);
}

function resolveBaseModel(
	workflows: WorkflowDefinition[],
	preferred: string | null,
	criteria: { approach: Approach; modality: Modality }
): string | null {
	const baseModels = getAvailableBaseModels(workflows, criteria);
	if (preferred && baseModels.includes(preferred)) {
		return preferred;
	}
	return baseModels[0] ?? null;
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

interface LoraSectionProps {
	adminLorasHref: string;
	availableLoras: LoraRegistryEntry[];
	form: ScenarioFormState;
	hasLora: boolean;
	loraSlots: ReturnType<typeof getLoraSlots>;
	onEnableLora: () => void;
	onParamChange: (key: string, value: string) => void;
	workflow: WorkflowDefinition;
}

function LoraSection({
	adminLorasHref,
	availableLoras,
	form,
	hasLora,
	loraSlots,
	onEnableLora,
	onParamChange,
	workflow,
}: LoraSectionProps) {
	if (hasLora && loraSlots.length > 0) {
		return (
			<LoraStack
				adminHref={adminLorasHref}
				availableLoras={availableLoras}
				form={form}
				onParamChange={onParamChange}
				slots={loraSlots}
				workflow={workflow}
			/>
		);
	}

	return (
		<button
			className="flex items-center gap-2.5 rounded-lg border border-foreground/15 border-dashed bg-foreground/[0.02] px-3 py-2.5 text-left transition hover:border-foreground/25 hover:bg-foreground/[0.04]"
			onClick={onEnableLora}
			type="button"
		>
			<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06]">
				<Sparkles
					aria-hidden="true"
					className="size-3.5 text-muted-foreground"
					strokeWidth={1.6}
				/>
			</span>
			<span className="grid flex-1">
				<span className="font-medium text-[12px]">Add LoRA style</span>
				<span className="text-[10px] text-muted-foreground">
					Apply a custom character or style trained for this base model.
				</span>
			</span>
			<Plus className="size-3.5 text-muted-foreground" />
		</button>
	);
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

interface ComposeFormProps {
	adminLorasHref: string;
	availableLoras: LoraRegistryEntry[];
	form: ScenarioFormState;
	formId?: string;
	hideFooter?: boolean;
	isSubmitting: boolean;
	onFormChange: (form: ScenarioFormState) => void;
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
	onFormChange,
	onSubmit,
	onValidityChange,
	workflows,
}: ComposeFormProps) {
	const nameId = useId();
	const promptId = useId();

	const selectedWorkflow =
		workflows.find((workflow) => workflow.key === form.workflowKey) ?? null;
	const selection = buildSelectionFromForm(selectedWorkflow);

	const availableModalities = useMemo(
		() => getAvailableModalities(workflows),
		[workflows]
	);

	const availableApproaches = useMemo(
		() =>
			selection ? getAvailableApproaches(workflows, selection.modality) : [],
		[workflows, selection]
	);

	const availableBaseModels = useMemo(
		() =>
			selection
				? getAvailableBaseModels(workflows, {
						approach: selection.approach,
						modality: selection.modality,
					})
				: [],
		[workflows, selection]
	);

	const availableVariants = useMemo(() => {
		if (!selection) {
			return [] as WorkflowDefinition[];
		}
		return findCandidateWorkflows(workflows, {
			approach: selection.approach,
			baseModel: selection.baseModel,
			hasLora: selection.hasLora,
			modality: selection.modality,
		});
	}, [workflows, selection]);

	const loraAvailable = useMemo(() => {
		if (!selection) {
			return false;
		}
		return supportsLora(workflows, selection);
	}, [workflows, selection]);

	const loraSlots = selectedWorkflow ? getLoraSlots(selectedWorkflow) : [];

	const partitioned = useMemo(() => {
		if (!selectedWorkflow) {
			return {
				advanced: [] as WorkflowParameter[],
				output: [] as WorkflowParameter[],
				sampling: [] as WorkflowParameter[],
			};
		}
		return partitionNonLoraParameters(selectedWorkflow);
	}, [selectedWorkflow]);

	const errors = useMemo(() => {
		if (!selectedWorkflow) {
			return ["Select a workflow"];
		}
		return validate(form, selectedWorkflow);
	}, [form, selectedWorkflow]);

	const promptLength = form.prompt.length;
	const isOverLimit = promptLength > PROMPT_LIMIT;
	const isReady = errors.length === 0 && !isOverLimit;
	const suggestedName = useMemo(
		() => suggestNameFromPrompt(form.prompt),
		[form.prompt]
	);

	useEffect(() => {
		onValidityChange?.({ errors, isReady });
	}, [errors, isReady, onValidityChange]);

	function applySelection(nextSelection: WorkflowSelection) {
		const nextWorkflow = findWorkflow(workflows, nextSelection);
		if (!nextWorkflow || nextWorkflow.key === form.workflowKey) {
			return;
		}
		const next = createScenarioFormState(nextWorkflow);
		onFormChange({
			...next,
			name: form.name,
			prompt: form.prompt,
		});
	}

	function handleModalityChange(nextModality: Modality) {
		if (!selection || nextModality === selection.modality) {
			return;
		}
		const nextApproach = resolveApproach(
			workflows,
			selection.approach,
			nextModality
		);
		const nextBaseModel = resolveBaseModel(workflows, selection.baseModel, {
			approach: nextApproach,
			modality: nextModality,
		});
		applySelection({
			approach: nextApproach,
			baseModel: nextBaseModel,
			hasLora: false,
			modality: nextModality,
		});
	}

	function handleApproachChange(nextApproach: Approach) {
		if (!selection || nextApproach === selection.approach) {
			return;
		}
		const nextBaseModel = resolveBaseModel(workflows, selection.baseModel, {
			approach: nextApproach,
			modality: selection.modality,
		});
		applySelection({
			...selection,
			approach: nextApproach,
			baseModel: nextBaseModel,
		});
	}

	function handleBaseModelChange(nextBaseModel: string) {
		if (!selection || nextBaseModel === selection.baseModel) {
			return;
		}
		applySelection({ ...selection, baseModel: nextBaseModel });
	}

	function handleEnableLora() {
		if (!selection || selection.hasLora) {
			return;
		}
		applySelection({ ...selection, hasLora: true });
	}

	function handleVariantChange(nextWorkflowKey: string) {
		if (!selection || nextWorkflowKey === form.workflowKey) {
			return;
		}
		applySelection({ ...selection, workflowKey: nextWorkflowKey });
	}

	function handleParamChange(key: string, value: string) {
		onFormChange({
			...form,
			params: { ...form.params, [key]: value },
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

	if (!(selectedWorkflow && selection)) {
		return (
			<div className="rounded-lg bg-rose-500/10 px-3 py-2 text-rose-700 text-xs dark:text-rose-300">
				No workflows are available.
			</div>
		);
	}

	return (
		<form className="grid min-w-0 gap-5" id={formId} onSubmit={handleSubmit}>
			<section className="grid gap-2">
				<SectionLabel>Workflow</SectionLabel>
				<WorkflowSelector
					approach={selection.approach}
					availableApproaches={availableApproaches}
					availableBaseModels={availableBaseModels}
					availableModalities={availableModalities}
					availableVariants={availableVariants}
					baseModel={selection.baseModel}
					modality={selection.modality}
					onApproachChange={handleApproachChange}
					onBaseModelChange={handleBaseModelChange}
					onModalityChange={handleModalityChange}
					onVariantChange={handleVariantChange}
					selectedWorkflowKey={selectedWorkflow.key}
				/>
				<p className="rounded-lg bg-foreground/[0.03] px-2.5 py-1.5 text-[11px] text-muted-foreground">
					<span className="font-medium text-foreground">
						{selectedWorkflow.name}.
					</span>{" "}
					{selectedWorkflow.summary}
				</p>
			</section>

			{loraAvailable ? (
				<section className="grid gap-2">
					<div className="flex items-center justify-between gap-2">
						<SectionLabel>Style LoRAs</SectionLabel>
						<span className="text-[10px] text-muted-foreground">
							{availableLoras.length} in registry
						</span>
					</div>
					<LoraSection
						adminLorasHref={adminLorasHref}
						availableLoras={availableLoras}
						form={form}
						hasLora={selection.hasLora}
						loraSlots={loraSlots}
						onEnableLora={handleEnableLora}
						onParamChange={handleParamChange}
						workflow={selectedWorkflow}
					/>
				</section>
			) : null}

			<section className="grid gap-2">
				<SectionLabel>Scenario</SectionLabel>
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
						<Label className="font-medium text-[11px]" htmlFor={promptId}>
							Prompt
						</Label>
						<div className="flex items-center gap-2">
							<EnhancePromptButton
								enhance={async (value) => {
									const result = await enhanceStudioPrompt(value);
									return result.enhanced;
								}}
								onEnhanced={(enhanced) => {
									onFormChange({ ...form, prompt: enhanced });
									toast.success("Prompt enhanced with Grok");
								}}
								onError={(message) => toast.error(message)}
								prompt={form.prompt}
							/>
							<span
								className={cn(
									"text-[10px] tabular-nums",
									getCharCounterTone(promptLength, isOverLimit)
								)}
							>
								{promptLength}/{PROMPT_LIMIT}
							</span>
						</div>
					</div>
					<textarea
						className={cn(
							"min-h-28 w-full resize-y rounded-lg border bg-background/45 px-2.5 py-2 text-xs leading-5 outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50",
							isOverLimit ? "border-rose-500/60" : "border-input"
						)}
						id={promptId}
						onChange={(event) =>
							onFormChange({ ...form, prompt: event.target.value })
						}
						placeholder={selectedWorkflow.promptHint}
						value={form.prompt}
					/>
				</div>
			</section>

			{partitioned.output.length > 0 ? (
				<section className="grid gap-2">
					<SectionLabel>Output</SectionLabel>
					<ParametersGroup
						form={form}
						onParamChange={handleParamChange}
						parameters={partitioned.output}
					/>
				</section>
			) : null}

			{partitioned.sampling.length > 0 ? (
				<section className="grid gap-2">
					<SectionLabel>Sampling</SectionLabel>
					<ParametersGroup
						form={form}
						onParamChange={handleParamChange}
						parameters={partitioned.sampling}
					/>
				</section>
			) : null}

			{partitioned.advanced.length > 0 ? (
				<AdvancedSection
					form={form}
					onParamChange={handleParamChange}
					parameters={partitioned.advanced}
				/>
			) : null}

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
