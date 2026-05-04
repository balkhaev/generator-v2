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
import { AlertCircle, ChevronDown, Loader2, Plus, Wand2 } from "lucide-react";
import {
	type Dispatch,
	type FormEvent,
	type SetStateAction,
	useEffect,
	useId,
	useMemo,
	useState,
} from "react";
import { toast } from "sonner";

import LoraStack from "./lora-stack";
import ParameterField from "./parameter-field";
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

// Reference image for prompt enhance: scenario-level workflows expose
// `image-url` parameters (e.g. `endImageUrl`) that point to a frame the
// generator will use as input. When the user clicks Enhance we want the
// vision-capable model to see that frame so it can describe the action
// from the correct starting state.
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
}: {
	onEnhanced: (enhanced: string) => void;
	prompt: string;
	referenceImageUrl: string | null;
}) {
	const hasImage = Boolean(referenceImageUrl);
	return (
		<EnhancePromptButton
			enhance={async (value) => {
				const result = await enhanceStudioPrompt(value, {
					imageUrl: referenceImageUrl,
				});
				if (result.notice) {
					toast.warning(result.notice);
				}
				return result.enhanced;
			}}
			label={hasImage ? "Enhance for image" : "Enhance"}
			onEnhanced={(enhanced) => {
				onEnhanced(enhanced);
				toast.success(
					hasImage
						? "Prompt rewritten for the reference image"
						: "Prompt enhanced"
				);
			}}
			onError={(message) => toast.error(message)}
			prompt={prompt}
			tooltip={
				hasImage
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

interface LoraSectionProps {
	adminLorasHref: string;
	availableLoras: LoraRegistryEntry[];
	form: ScenarioFormState;
	isOptional: boolean;
	loraSlots: LoraSlotDefinition[];
	lorasError: string | null;
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

interface ComposeFormProps {
	adminLorasHref: string;
	availableLoras: LoraRegistryEntry[];
	form: ScenarioFormState;
	formId?: string;
	hideFooter?: boolean;
	isSubmitting: boolean;
	lorasError?: string | null;
	onFormChange: Dispatch<SetStateAction<ScenarioFormState | null>>;
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
	onSubmit,
	onValidityChange,
	workflows,
}: ComposeFormProps) {
	const nameId = useId();
	const promptId = useId();

	const selectedWorkflow =
		workflows.find((workflow) => workflow.key === form.workflowKey) ?? null;
	const selectedClassification = selectedWorkflow
		? classifyWorkflow(selectedWorkflow)
		: null;

	const availableModalities = useMemo(
		() => getAvailableModalities(workflows),
		[workflows]
	);

	const availableApproaches = useMemo(
		() =>
			selectedClassification
				? getAvailableApproaches(workflows, selectedClassification.modality)
				: [],
		[workflows, selectedClassification]
	);

	const filteredWorkflows = useMemo(() => {
		if (!selectedClassification) {
			return [] as WorkflowDefinition[];
		}
		return filterWorkflows(workflows, {
			approach: selectedClassification.approach,
			modality: selectedClassification.modality,
		});
	}, [workflows, selectedClassification]);

	const loraSlots = selectedWorkflow ? getLoraSlots(selectedWorkflow) : [];
	const showLoraSection = Boolean(
		selectedClassification?.hasLora && loraSlots.length > 0
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
		const next = createComposeScenarioFormState(nextWorkflow);
		onFormChange({
			...next,
			name: form.name,
			prompt: form.prompt,
		});
	}

	function handleModalityChange(nextModality: Modality) {
		if (
			!selectedClassification ||
			nextModality === selectedClassification.modality
		) {
			return;
		}
		const nextApproach = resolveApproach(
			workflows,
			selectedClassification.approach,
			nextModality
		);
		applyWorkflow(
			pickDefaultWorkflow(workflows, {
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
			pickDefaultWorkflow(workflows, {
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
			workflows.find((workflow) => workflow.key === nextWorkflowKey) ?? null
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
			<section className="grid gap-2">
				<SectionLabel>Workflow</SectionLabel>
				<WorkflowGrid
					approach={selectedClassification.approach}
					availableApproaches={availableApproaches}
					availableModalities={availableModalities}
					filteredWorkflows={filteredWorkflows}
					modality={selectedClassification.modality}
					onApproachChange={handleApproachChange}
					onModalityChange={handleModalityChange}
					onWorkflowChange={handleWorkflowChange}
					selectedWorkflowKey={selectedWorkflow.key}
				/>
			</section>

			{showLoraSection && selectedClassification ? (
				<LoraSection
					adminLorasHref={adminLorasHref}
					availableLoras={availableLoras}
					form={form}
					isOptional={!selectedClassification.requiresLora}
					loraSlots={loraSlots}
					lorasError={lorasError}
					onParamChange={handleParamChange}
					selectedWorkflow={selectedWorkflow}
				/>
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
							<ScenarioEnhancePromptButton
								onEnhanced={(enhanced) =>
									onFormChange({ ...form, prompt: enhanced })
								}
								prompt={form.prompt}
								referenceImageUrl={referenceImageUrl}
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
					{isImageToVideo ? (
						<p className="rounded-lg bg-foreground/[0.03] px-3 py-2 text-[11px] text-muted-foreground">
							Output keeps the source image proportions automatically.
						</p>
					) : null}
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
