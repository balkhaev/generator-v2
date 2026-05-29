"use client";

import {
	createScenarioFormState,
	type ScenarioFormState,
	type WorkflowDefinition,
} from "@generator/studio-client/shared";
import { BadgeInfo, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import ParameterField from "./parameter-field";

export const RUNPOD_FLUX_NOISIFY_WORKFLOW_KEY = "runpod-flux-dev-image";

const FLUX_NOISIFY_SOURCE_URL =
	"https://hel1.your-objectstorage.com/generator/loras/external/external-7919a4063730eca7.safetensors";
const RUNPOD_FLUX_NOISIFY_LORA_FILENAME = "noisify.safetensors";

const FLUX_NOISIFY_DEFAULT_PARAMS = {
	loraFilename: RUNPOD_FLUX_NOISIFY_LORA_FILENAME,
	loraScale: "1",
} as const;

const hiddenParamKeys = new Set(["loraFilename"]);

export function isRunpodFluxNoisifyWorkflow(
	workflow: Pick<WorkflowDefinition, "key">
): boolean {
	return workflow.key === RUNPOD_FLUX_NOISIFY_WORKFLOW_KEY;
}

export function createRunpodFluxNoisifyFormState(
	workflow: WorkflowDefinition,
	current?: ScenarioFormState | null
): ScenarioFormState {
	const base = createScenarioFormState(workflow);
	const params = {
		...base.params,
		...FLUX_NOISIFY_DEFAULT_PARAMS,
	};
	if (!current) {
		return { ...base, params };
	}
	return {
		...base,
		params: {
			...params,
			...current.params,
			...FLUX_NOISIFY_DEFAULT_PARAMS,
		},
	};
}

interface RunpodFluxNoisifyFieldsProps {
	form: ScenarioFormState;
	onParamChange: (key: string, value: string) => void;
	workflow: WorkflowDefinition;
}

export function RunpodFluxNoisifyFields({
	form,
	onParamChange,
	workflow,
}: RunpodFluxNoisifyFieldsProps): ReactNode {
	const visibleParams = workflow.parameters.filter(
		(p) => !hiddenParamKeys.has(p.key)
	);

	return (
		<div className="space-y-4">
			<div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-muted-foreground text-sm">
				<BadgeInfo className="mt-0.5 size-4 shrink-0" />
				<p>
					Flux.1-dev text-to-image на RunPod serverless с LoRA{" "}
					<a
						className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
						href={FLUX_NOISIFY_SOURCE_URL}
						rel="noopener noreferrer"
						target="_blank"
					>
						Noisify
						<ExternalLink className="size-3" />
					</a>
					. LoRA pre-provisioned на volume ({RUNPOD_FLUX_NOISIFY_LORA_FILENAME}
					). Self-hosted, без цензуры.
				</p>
			</div>
			{visibleParams.map((parameter) => (
				<ParameterField
					key={parameter.key}
					onChange={(value) => onParamChange(parameter.key, value)}
					parameter={parameter}
					value={form.params[parameter.key] ?? ""}
				/>
			))}
		</div>
	);
}
