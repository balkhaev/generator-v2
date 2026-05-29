"use client";

import {
	createScenarioFormState,
	type ScenarioFormState,
	type WorkflowDefinition,
} from "@generator/studio-client/shared";
import { BadgeInfo, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import ParameterField from "./parameter-field";

export const RUNPOD_WAN22_PUSSY_WORKFLOW_KEY = "runpod-wan-2-2-image-to-video";

const CIVITAI_WAN22_PUSSY_SOURCE_URL =
	"https://civitai.com/models/1895314/wan22-pussy-t2vi2v?modelVersionId=2145434";
const RUNPOD_WAN22_PUSSY_LORA_HIGH_FILENAME =
	"wan22-pussy-high_noise.safetensors";
const RUNPOD_WAN22_PUSSY_LORA_LOW_FILENAME =
	"wan22-pussy-low_noise.safetensors";

const WAN22_PUSSY_DEFAULT_PARAMS = {
	loraHighFilename: RUNPOD_WAN22_PUSSY_LORA_HIGH_FILENAME,
	loraLowFilename: RUNPOD_WAN22_PUSSY_LORA_LOW_FILENAME,
	loraScale: "1",
} as const;

const hiddenParamKeys = new Set([
	"loraHighFilename",
	"loraLowFilename",
	"loraCivitaiModelId",
	"loraCivitaiVersionId",
]);

export function isRunpodWan22PussyWorkflow(
	workflow: Pick<WorkflowDefinition, "key">
): boolean {
	return workflow.key === RUNPOD_WAN22_PUSSY_WORKFLOW_KEY;
}

export function createRunpodWan22PussyFormState(
	workflow: WorkflowDefinition,
	current?: ScenarioFormState | null
): ScenarioFormState {
	const base = createScenarioFormState(workflow);
	const params = {
		...base.params,
		...WAN22_PUSSY_DEFAULT_PARAMS,
	};
	if (!current) {
		return { ...base, params };
	}
	return {
		...base,
		params: {
			...params,
			...current.params,
			...WAN22_PUSSY_DEFAULT_PARAMS,
		},
	};
}

interface RunpodWan22PussyFieldsProps {
	form: ScenarioFormState;
	onParamChange: (key: string, value: string) => void;
	workflow: WorkflowDefinition;
}

export function RunpodWan22PussyFields({
	form,
	onParamChange,
	workflow,
}: RunpodWan22PussyFieldsProps): ReactNode {
	const visibleParams = workflow.parameters.filter(
		(p) => !hiddenParamKeys.has(p.key)
	);

	return (
		<div className="space-y-4">
			<div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-muted-foreground text-sm">
				<BadgeInfo className="mt-0.5 size-4 shrink-0" />
				<p>
					Wan 2.2 I2V на RunPod serverless с LoRA{" "}
					<a
						className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
						href={CIVITAI_WAN22_PUSSY_SOURCE_URL}
						rel="noopener noreferrer"
						target="_blank"
					>
						Wan2.2 — Pussy
						<ExternalLink className="size-3" />
					</a>
					. High/low LoRA pre-provisioned на volume (
					{RUNPOD_WAN22_PUSSY_LORA_HIGH_FILENAME} /{" "}
					{RUNPOD_WAN22_PUSSY_LORA_LOW_FILENAME}).
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
