const surroundingQuotePattern = /^["'`]+|["'`]+$/g;
const codeFencePattern = /^[\s`]*```(?:[a-z]+)?|```[\s`]*$/giu;
const whitespacePattern = /\s+/g;

const metaResponsePatterns = [
	/\*\*\s*(conflict|decision|resolution|correction)\s*:\s*\*\*/iu,
	/(^|\n)\s*(conflict|decision|resolution|to proceed|correction based on strict rules)\s*:/iu,
	/the prompt you provided describes/iu,
	/the user brief you gave me describes/iu,
	/action impossible/iu,
	/hard intent rules/iu,
	/actually,\s*let's re-read/iu,
	/\bi will write the prompt\b/iu,
] as const;

function isMetaResponse(value: string): boolean {
	return metaResponsePatterns.some((pattern) => pattern.test(value));
}

export function cleanPromptOutput(value: string): string {
	if (isMetaResponse(value)) {
		throw new Error(
			"Prompt enhance returned analysis instead of a rewritten prompt"
		);
	}
	return value
		.replace(codeFencePattern, "")
		.trim()
		.replace(surroundingQuotePattern, "")
		.trim()
		.replace(whitespacePattern, " ");
}
