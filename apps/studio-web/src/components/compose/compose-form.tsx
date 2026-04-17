"use client";

import type { LoraRegistryEntry } from "@generator/contracts/loras";
import {
	createScenarioFormState,
	type ScenarioFormState,
	type WorkflowDefinition,
	type WorkflowParameter,
} from "@generator/studio-client/shared";
import { Button } from "@generator/ui/components/button";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { SectionLabel } from "@generator/ui/components/section-label";
import { cn } from "@generator/ui/lib/utils";
import {
	AlertCircle,
	Brain,
	ChevronDown,
	Image as ImageIcon,
	Loader2,
	Plus,
	Sparkles,
	Wand2,
} from "lucide-react";
import { type FormEvent, useId, useMemo, useState } from "react";

import LoraPicker from "./lora-picker";
import ParameterField from "./parameter-field";

const baseModelLabels: Record<string, string> = {
	flux: "Flux",
	other: "Other",
	sdxl: "SDXL",
	"z-image": "Z-Image",
};

const baseModelTints: Record<string, string> = {
	flux: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
	other: "bg-foreground/[0.06] text-muted-foreground",
	sdxl: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
	"z-image": "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
};

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

function findWeightParameter(
	loraUrlKey: string,
	parameters: WorkflowParameter[]
) {
	const base = loraUrlKey.replace(loraUrlSuffixPattern, "");
	return (
		parameters.find(
			(parameter) =>
				parameter.key === `${base}Weight` || parameter.key === `${base}Scale`
		) ?? null
	);
}

function partitionParameters(parameters: WorkflowParameter[]) {
	const handledKeys = new Set<string>();
	const loraGroups: {
		urlParameter: WorkflowParameter;
		weightParameter: WorkflowParameter | null;
	}[] = [];
	const outputParameters: WorkflowParameter[] = [];
	const samplingParameters: WorkflowParameter[] = [];
	const advancedParameters: WorkflowParameter[] = [];

	for (const parameter of parameters) {
		if (parameter.kind === "lora-url") {
			const weightParameter = findWeightParameter(parameter.key, parameters);
			handledKeys.add(parameter.key);
			if (weightParameter) {
				handledKeys.add(weightParameter.key);
			}
			loraGroups.push({ urlParameter: parameter, weightParameter });
		}
	}

	for (const parameter of parameters) {
		if (handledKeys.has(parameter.key)) {
			continue;
		}

		if (
			parameter.key === "imageSize" ||
			parameter.key === "numImages" ||
			parameter.key === "outputFormat"
		) {
			outputParameters.push(parameter);
			continue;
		}

		if (parameter.key === "seed") {
			advancedParameters.push(parameter);
			continue;
		}

		samplingParameters.push(parameter);
	}

	return {
		advancedParameters,
		loraGroups,
		outputParameters,
		samplingParameters,
	};
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
				errors.push(`${parameter.label} is required`);
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

function WorkflowCard({
	isActive,
	onSelect,
	workflow,
}: {
	isActive: boolean;
	onSelect: () => void;
	workflow: WorkflowDefinition;
}) {
	const usesLora = workflow.parameters.some(
		(parameter) => parameter.kind === "lora-url"
	);

	return (
		<button
			aria-pressed={isActive}
			className={cn(
				"flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
				isActive
					? "bg-foreground text-background"
					: "bg-foreground/[0.04] hover:bg-foreground/[0.08]"
			)}
			onClick={onSelect}
			type="button"
		>
			<div
				className={cn(
					"flex size-7 shrink-0 items-center justify-center rounded-md",
					isActive ? "bg-background/15" : "bg-foreground/[0.06]"
				)}
			>
				{usesLora ? (
					<Brain className="size-3.5" strokeWidth={1.6} />
				) : (
					<Sparkles className="size-3.5" strokeWidth={1.6} />
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<p className="truncate font-medium text-xs">{workflow.name}</p>
					{workflow.requiresInputImage ? (
						<span
							className={cn(
								"inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px]",
								isActive
									? "bg-background/20 text-background"
									: "bg-sky-500/12 text-sky-700 dark:text-sky-300"
							)}
						>
							<ImageIcon className="size-2.5" />
							img2img
						</span>
					) : null}
					{usesLora ? (
						<span
							className={cn(
								"rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide",
								isActive
									? "bg-background/20 text-background"
									: "bg-foreground/[0.06] text-muted-foreground"
							)}
						>
							LoRA
						</span>
					) : null}
				</div>
				<p
					className={cn(
						"mt-0.5 line-clamp-2 text-[11px] leading-snug",
						isActive ? "text-background/70" : "text-muted-foreground"
					)}
				>
					{workflow.summary}
				</p>
			</div>
		</button>
	);
}

interface LoraSlotProps {
	adminLorasHref: string;
	availableLoras: LoraRegistryEntry[];
	baseModel?: string;
	form: ScenarioFormState;
	group: {
		urlParameter: WorkflowParameter;
		weightParameter: WorkflowParameter | null;
	};
	onParamChange: (key: string, value: string) => void;
}

function LoraSlot({
	adminLorasHref,
	availableLoras,
	baseModel,
	form,
	group,
	onParamChange,
}: LoraSlotProps) {
	const weightParameter = group.weightParameter;
	const weightConfig =
		weightParameter &&
		weightParameter.min !== undefined &&
		weightParameter.max !== undefined
			? {
					max: weightParameter.max,
					min: weightParameter.min,
					step: weightParameter.step ?? 0.05,
				}
			: undefined;

	const weight = weightParameter
		? Number(form.params[weightParameter.key])
		: undefined;
	const numericWeight = Number.isFinite(weight)
		? (weight as number)
		: undefined;

	return (
		<LoraPicker
			adminHref={adminLorasHref}
			allowNone={group.urlParameter.optional}
			baseModelHint={
				baseModel ? `for ${baseModelLabels[baseModel] ?? baseModel}` : undefined
			}
			emptyHint={baseModel ? `Add ${baseModel} LoRAs in admin` : undefined}
			loras={availableLoras}
			onUrlChange={(url) => onParamChange(group.urlParameter.key, url)}
			onWeightChange={
				weightParameter
					? (next) => onParamChange(weightParameter.key, String(next))
					: undefined
			}
			title={group.urlParameter.label}
			url={form.params[group.urlParameter.key] ?? ""}
			weight={numericWeight}
			weightConfig={weightConfig}
			weightLabel={weightParameter?.label ?? "Weight"}
		/>
	);
}

interface ComposeFormProps {
	adminLorasHref: string;
	availableLoras: LoraRegistryEntry[];
	form: ScenarioFormState;
	isSubmitting: boolean;
	onFormChange: (form: ScenarioFormState) => void;
	onSubmit: () => Promise<void> | void;
	workflows: WorkflowDefinition[];
}

export default function ComposeForm({
	adminLorasHref,
	availableLoras,
	form,
	isSubmitting,
	onFormChange,
	onSubmit,
	workflows,
}: ComposeFormProps) {
	const nameId = useId();
	const promptId = useId();
	const [advancedOpen, setAdvancedOpen] = useState(false);

	const workflowsByBaseModel = useMemo(() => {
		const groups = new Map<string, WorkflowDefinition[]>();
		for (const workflow of workflows) {
			const key = workflow.baseModel ?? "other";
			const list = groups.get(key) ?? [];
			list.push(workflow);
			groups.set(key, list);
		}
		return groups;
	}, [workflows]);

	const selectedWorkflow =
		workflows.find((workflow) => workflow.key === form.workflowKey) ?? null;

	const partitioned = useMemo(() => {
		if (!selectedWorkflow) {
			return {
				advancedParameters: [],
				loraGroups: [],
				outputParameters: [],
				samplingParameters: [],
			};
		}
		return partitionParameters(selectedWorkflow.parameters);
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

	function handleWorkflowSelect(workflow: WorkflowDefinition) {
		const next = createScenarioFormState(workflow);
		onFormChange({
			...next,
			name: form.name,
			prompt: form.prompt,
		});
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

	if (!selectedWorkflow) {
		return (
			<div className="rounded-lg bg-rose-500/10 px-3 py-2 text-rose-700 text-xs dark:text-rose-300">
				No workflows are available.
			</div>
		);
	}

	return (
		<form className="grid gap-4 pb-20" onSubmit={handleSubmit}>
			<section className="grid gap-2">
				<div className="flex items-center justify-between gap-2">
					<SectionLabel>Workflow</SectionLabel>
					<span className="text-[10px] text-muted-foreground">
						{workflows.length} available
					</span>
				</div>
				<div className="grid gap-3">
					{Array.from(workflowsByBaseModel.entries()).map(
						([baseModel, models]) => (
							<div className="grid gap-1.5" key={baseModel}>
								<div className="flex items-center gap-2">
									<span
										className={cn(
											"rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide",
											baseModelTints[baseModel] ?? baseModelTints.other
										)}
									>
										{baseModelLabels[baseModel] ?? baseModel}
									</span>
									<span className="text-[10px] text-muted-foreground">
										{models.length} model{models.length === 1 ? "" : "s"}
									</span>
								</div>
								<div className="grid gap-1">
									{models.map((workflow) => (
										<WorkflowCard
											isActive={workflow.key === selectedWorkflow.key}
											key={workflow.key}
											onSelect={() => handleWorkflowSelect(workflow)}
											workflow={workflow}
										/>
									))}
								</div>
							</div>
						)
					)}
				</div>
			</section>

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
						<span
							className={cn(
								"text-[10px] tabular-nums",
								getCharCounterTone(promptLength, isOverLimit)
							)}
						>
							{promptLength}/{PROMPT_LIMIT}
						</span>
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

			{partitioned.loraGroups.length > 0 ? (
				<section className="grid gap-2">
					<div className="flex items-center justify-between gap-2">
						<SectionLabel>Identity · LoRAs</SectionLabel>
						<span className="text-[10px] text-muted-foreground">
							{availableLoras.length} registered
						</span>
					</div>
					<div className="grid gap-2">
						{partitioned.loraGroups.map((group) => (
							<LoraSlot
								adminLorasHref={adminLorasHref}
								availableLoras={availableLoras}
								baseModel={selectedWorkflow.baseModel}
								form={form}
								group={group}
								key={group.urlParameter.key}
								onParamChange={handleParamChange}
							/>
						))}
					</div>
				</section>
			) : null}

			{partitioned.outputParameters.length > 0 ? (
				<section className="grid gap-2">
					<SectionLabel>Output</SectionLabel>
					<div className="grid gap-3">
						{partitioned.outputParameters.map((parameter) => (
							<ParameterField
								key={parameter.key}
								onChange={(value) => handleParamChange(parameter.key, value)}
								parameter={parameter}
								value={form.params[parameter.key] ?? parameter.defaultValue}
							/>
						))}
					</div>
				</section>
			) : null}

			{partitioned.samplingParameters.length > 0 ? (
				<section className="grid gap-2">
					<SectionLabel>Sampling</SectionLabel>
					<div className="grid gap-3">
						{partitioned.samplingParameters.map((parameter) => (
							<ParameterField
								key={parameter.key}
								onChange={(value) => handleParamChange(parameter.key, value)}
								parameter={parameter}
								value={form.params[parameter.key] ?? parameter.defaultValue}
							/>
						))}
					</div>
				</section>
			) : null}

			{partitioned.advancedParameters.length > 0 ? (
				<section className="grid gap-2">
					<button
						aria-expanded={advancedOpen}
						className="flex w-full items-center justify-between rounded-lg bg-foreground/[0.03] px-3 py-2 text-left transition hover:bg-foreground/[0.06]"
						onClick={() => setAdvancedOpen((current) => !current)}
						type="button"
					>
						<SectionLabel>Advanced</SectionLabel>
						<ChevronDown
							className={cn(
								"size-3.5 text-muted-foreground transition-transform",
								advancedOpen && "rotate-180"
							)}
						/>
					</button>
					{advancedOpen ? (
						<div className="grid gap-3 px-1">
							{partitioned.advancedParameters.map((parameter) => (
								<ParameterField
									key={parameter.key}
									onChange={(value) => handleParamChange(parameter.key, value)}
									parameter={parameter}
									value={form.params[parameter.key] ?? parameter.defaultValue}
								/>
							))}
						</div>
					) : null}
				</section>
			) : null}

			<div className="sticky bottom-0 z-10 -mx-3 mt-2 -mb-3 border-foreground/8 border-t bg-background/95 px-3 py-2 backdrop-blur">
				{errors.length > 0 ? (
					<div className="mb-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
						<AlertCircle className="mt-0.5 size-3 shrink-0" />
						<span>{errors.join(" · ")}</span>
					</div>
				) : null}
				<div className="flex items-center justify-between gap-2">
					<p className="text-[11px] text-muted-foreground">
						{selectedWorkflow.name}
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
		</form>
	);
}
