import type { LoraRegistryEntry } from "@generator/contracts/loras";
import { buildPromptWithTriggerWords } from "@generator/contracts/studio";
import type { WorkflowDefinition } from "@generator/studio-client/shared";

export function buildFinalPromptPreview(input: {
	availableLoras: LoraRegistryEntry[];
	params: Record<string, unknown>;
	prompt: string;
	workflow: WorkflowDefinition;
}) {
	const lorasByUrl = new Map(
		input.availableLoras.map((entry) => [entry.s3Url, entry])
	);
	const triggerWords: string[] = [];

	for (const parameter of input.workflow.parameters) {
		if (parameter.kind !== "lora-url") {
			continue;
		}
		const rawUrl = input.params[parameter.key];
		if (typeof rawUrl !== "string") {
			continue;
		}
		const url = rawUrl.trim();
		if (!url) {
			continue;
		}
		const entry = lorasByUrl.get(url);
		if (!entry) {
			continue;
		}
		for (const word of entry.triggerWords) {
			triggerWords.push(word);
		}
	}

	return buildPromptWithTriggerWords({
		prompt: input.prompt,
		triggerWords,
	});
}
