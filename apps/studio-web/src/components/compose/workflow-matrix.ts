import type { WorkflowDefinition } from "@generator/studio-client/shared";

export type Modality = "image" | "video";
export type Approach = "text" | "image";

export interface WorkflowClassification {
	approach: Approach;
	hasLora: boolean;
	maxLoraSlots: number;
	modality: Modality;
}

export interface WorkflowFilter {
	approach: Approach;
	modality: Modality;
}

export function classifyWorkflow(
	workflow: WorkflowDefinition
): WorkflowClassification {
	const isVideo = workflow.key.includes("video");
	const loraParameters = workflow.parameters.filter(
		(parameter) => parameter.kind === "lora-url"
	);

	return {
		approach: workflow.requiresInputImage ? "image" : "text",
		hasLora: loraParameters.length > 0,
		maxLoraSlots: loraParameters.length,
		modality: isVideo ? "video" : "image",
	};
}

export function getAvailableModalities(
	workflows: WorkflowDefinition[]
): Modality[] {
	const seen = new Set<Modality>();
	for (const workflow of workflows) {
		seen.add(classifyWorkflow(workflow).modality);
	}
	return Array.from(seen);
}

export function getAvailableApproaches(
	workflows: WorkflowDefinition[],
	modality: Modality
): Approach[] {
	const seen = new Set<Approach>();
	for (const workflow of workflows) {
		const classification = classifyWorkflow(workflow);
		if (classification.modality === modality) {
			seen.add(classification.approach);
		}
	}
	return Array.from(seen);
}

export function filterWorkflows(
	workflows: WorkflowDefinition[],
	filter: WorkflowFilter
): WorkflowDefinition[] {
	return workflows.filter((workflow) => {
		const classification = classifyWorkflow(workflow);
		return (
			classification.modality === filter.modality &&
			classification.approach === filter.approach
		);
	});
}

export function pickDefaultWorkflow(
	workflows: WorkflowDefinition[],
	filter: WorkflowFilter
): WorkflowDefinition | null {
	const matches = filterWorkflows(workflows, filter);
	if (matches.length === 0) {
		return null;
	}
	const noLora = matches.find(
		(workflow) => !classifyWorkflow(workflow).hasLora
	);
	return noLora ?? matches[0] ?? null;
}

export interface LoraSlotDefinition {
	label: string;
	optional: boolean;
	urlKey: string;
	weightKey: string | null;
}

const loraUrlSuffixPattern = /Url$/i;

export function getLoraSlots(
	workflow: WorkflowDefinition
): LoraSlotDefinition[] {
	const slots: LoraSlotDefinition[] = [];
	for (const parameter of workflow.parameters) {
		if (parameter.kind !== "lora-url") {
			continue;
		}
		const base = parameter.key.replace(loraUrlSuffixPattern, "");
		const weightParameter =
			workflow.parameters.find(
				(other) => other.key === `${base}Weight` || other.key === `${base}Scale`
			) ?? null;
		slots.push({
			label: parameter.label,
			optional: Boolean(parameter.optional),
			urlKey: parameter.key,
			weightKey: weightParameter?.key ?? null,
		});
	}
	return slots;
}
