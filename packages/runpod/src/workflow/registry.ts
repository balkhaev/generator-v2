import type { AnyWorkflowDefinition } from "./definition";

export type { WorkflowDefinition } from "./definition";

export class UnknownWorkflowError extends Error {
	constructor(workflowId: string) {
		super(`Unknown RunPod workflow: ${workflowId}`);
		this.name = "UnknownWorkflowError";
	}
}

export interface WorkflowRegistry {
	get(workflowId: string): AnyWorkflowDefinition;
	has(workflowId: string): boolean;
	list(): readonly AnyWorkflowDefinition[];
}

export function createWorkflowRegistry(
	workflows: readonly AnyWorkflowDefinition[]
): WorkflowRegistry {
	const index = new Map<string, AnyWorkflowDefinition>();
	for (const workflow of workflows) {
		if (!workflow.id || workflow.id.includes(":")) {
			throw new Error(
				`RunPod workflow id must be non-empty and not contain ':' (got: ${workflow.id})`
			);
		}
		if (index.has(workflow.id)) {
			throw new Error(`Duplicate RunPod workflow id: ${workflow.id}`);
		}
		validateWorkflow(workflow);
		index.set(workflow.id, workflow);
	}

	return {
		get(workflowId) {
			const workflow = index.get(workflowId);
			if (!workflow) {
				throw new UnknownWorkflowError(workflowId);
			}
			return workflow;
		},
		has(workflowId) {
			return index.has(workflowId);
		},
		list() {
			return Array.from(index.values());
		},
	};
}

function validateWorkflow(workflow: AnyWorkflowDefinition): void {
	if (workflow.mode === "serverless") {
		if (!workflow.endpointId) {
			throw new Error(`Serverless workflow ${workflow.id} requires endpointId`);
		}
		return;
	}
	// Static pod: под уже поднят и держит примонтированный том, поэтому
	// engine не аллоцирует volume и не создаёт под из image/template —
	// требований к networkVolumes/imageName/templateId нет.
	if (workflow.pod.comfyBaseUrl) {
		return;
	}
	if (workflow.pod.networkVolumes.length === 0) {
		throw new Error(
			`Pod workflow ${workflow.id} requires at least one networkVolume`
		);
	}
	for (const [index, volume] of workflow.pod.networkVolumes.entries()) {
		if (volume.gpuTypeIds.length === 0) {
			throw new Error(
				`Pod workflow ${workflow.id} networkVolumes[${index}] has no gpuTypeIds`
			);
		}
		if (!volume.networkVolumeId) {
			throw new Error(
				`Pod workflow ${workflow.id} networkVolumes[${index}] requires networkVolumeId`
			);
		}
	}
	if (!workflow.pod.imageName) {
		throw new Error(`Pod workflow ${workflow.id} requires pod.imageName`);
	}
	if (!workflow.pod.templateId) {
		throw new Error(
			`Pod workflow ${workflow.id} requires pod.templateId (template-driven runtime)`
		);
	}
}
