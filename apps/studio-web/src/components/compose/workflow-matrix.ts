import type { WorkflowDefinition } from "@generator/studio-client/shared";

export type Modality = "image" | "video";
export type Approach = "text" | "image";

export interface WorkflowClassification {
	approach: Approach;
	hasLora: boolean;
	maxLoraSlots: number;
	modality: Modality;
}

export interface WorkflowSelection {
	approach: Approach;
	baseModel: string | null;
	hasLora: boolean;
	modality: Modality;
	workflowKey?: string;
}

export function classifyWorkflow(
	workflow: WorkflowDefinition
): WorkflowClassification {
	const key = workflow.key;
	const isVideo = key.includes("video");
	const isImageInput = workflow.requiresInputImage;
	const loraParameters = workflow.parameters.filter(
		(parameter) => parameter.kind === "lora-url"
	);

	return {
		approach: isImageInput ? "image" : "text",
		hasLora: loraParameters.length > 0,
		maxLoraSlots: loraParameters.length,
		modality: isVideo ? "video" : "image",
	};
}

export function getAvailableBaseModels(
	workflows: WorkflowDefinition[],
	criteria: Pick<WorkflowSelection, "approach" | "modality">
): string[] {
	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const workflow of workflows) {
		const classification = classifyWorkflow(workflow);
		if (
			classification.modality !== criteria.modality ||
			classification.approach !== criteria.approach
		) {
			continue;
		}
		const baseModel = workflow.baseModel ?? "other";
		if (!seen.has(baseModel)) {
			seen.add(baseModel);
			ordered.push(baseModel);
		}
	}
	return ordered;
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

export function supportsLora(
	workflows: WorkflowDefinition[],
	criteria: Pick<WorkflowSelection, "approach" | "baseModel" | "modality">
): boolean {
	return workflows.some((workflow) => {
		const classification = classifyWorkflow(workflow);
		const baseModel = workflow.baseModel ?? "other";
		return (
			classification.modality === criteria.modality &&
			classification.approach === criteria.approach &&
			(criteria.baseModel ? baseModel === criteria.baseModel : true) &&
			classification.hasLora
		);
	});
}

export function findCandidateWorkflows(
	workflows: WorkflowDefinition[],
	criteria: Omit<WorkflowSelection, "workflowKey">
): WorkflowDefinition[] {
	return workflows.filter((workflow) => {
		const classification = classifyWorkflow(workflow);
		const baseModel = workflow.baseModel ?? "other";
		return (
			classification.modality === criteria.modality &&
			classification.approach === criteria.approach &&
			(criteria.baseModel ? baseModel === criteria.baseModel : true) &&
			classification.hasLora === criteria.hasLora
		);
	});
}

export function findWorkflow(
	workflows: WorkflowDefinition[],
	criteria: WorkflowSelection
): WorkflowDefinition | null {
	const candidates = findCandidateWorkflows(workflows, criteria);

	if (candidates.length > 0) {
		if (criteria.workflowKey) {
			const exact = candidates.find(
				(workflow) => workflow.key === criteria.workflowKey
			);
			if (exact) {
				return exact;
			}
		}
		return candidates[0] ?? null;
	}

	if (criteria.hasLora) {
		return findWorkflow(workflows, { ...criteria, hasLora: false });
	}

	return null;
}

export function describeWorkflowSelection(
	workflow: WorkflowDefinition
): WorkflowSelection {
	const classification = classifyWorkflow(workflow);
	return {
		approach: classification.approach,
		baseModel: workflow.baseModel ?? null,
		hasLora: classification.hasLora,
		modality: classification.modality,
	};
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
