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

// Content-policy refusals leak through as a "successful" 200 response with the
// refusal text as the body. Without this guard the refusal sentence gets
// returned to the user verbatim as the "enhanced" prompt. Detecting it lets the
// caller fall back to another vision model (and finally to text-only enhance)
// instead of surfacing the refusal. Keep these anchored to refusal phrasing so
// legitimate comma-separated scene prompts never trip them.
const refusalPatterns = [
	/\bi\s+(?:cannot|can'?t|can\s?not|won'?t|will\s+not)\s+(?:generate|create|write|produce|assist|help|provide|fulfil|fulfill|comply|continue)/iu,
	/\bi'?m\s+(?:sorry|unable|not\s+able)\b/iu,
	/\bi\s+am\s+(?:sorry|unable|not\s+able)\b/iu,
	/\bi\s+can,?\s+however\b/iu,
	/\bas\s+an\s+ai\b/iu,
	/\bsexually\s+explicit\s+content\b/iu,
	/\bagainst\s+my\s+(?:guidelines|programming|policy)\b/iu,
	/\b(?:violates|against)\s+(?:the\s+)?(?:content|usage)\s+(?:policy|policies|guidelines)\b/iu,
] as const;

function isRefusal(value: string): boolean {
	return refusalPatterns.some((pattern) => pattern.test(value));
}

export function cleanPromptOutput(value: string): string {
	if (isRefusal(value)) {
		throw new Error(
			"Prompt enhance was refused by the model (content moderation)"
		);
	}
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
